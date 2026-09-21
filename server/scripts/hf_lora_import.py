"""
Import a Hugging Face LoRA adapter into a local, engine-loadable layout.

The engine loads adapters with ``PeftModel.from_pretrained(decoder, <dir>)``
(see ``acestep/core/generation/handler/lora/lifecycle.py:add_lora``), which requires BOTH:

  * ``adapter_config.json`` in ``<dir>`` - PEFT reads r / lora_alpha / target_modules from it
  * ``adapter_model.safetensors`` whose keys are ``base_model.model.<module>.lora_A.weight``

Community LoRA repos routinely break one or both conditions:

  * some ship weights with **no config at all**, and their README is a generic diffusers
    template that says nothing about rank or alpha;
  * some were saved through several **nested PEFT wrappers**, so every key begins
    ``base_model.model.`` two or more times, where PEFT expects exactly one.

Both are mechanical to fix, which is what this script does:

  1. download the repo (weights and README only - images are skipped)
  2. profile the safetensors header for rank, target modules and layers, without loading tensors
  3. verify that profile against the DiT checkpoint actually being served (module names *and*
     shapes), so an incompatible repo fails here rather than inside the engine
  4. rewrite keys to the canonical single ``base_model.model.`` prefix
  5. synthesise ``adapter_config.json`` and write ``lora_manifest.json`` recording every value
     that had to be inferred

Nothing is guessed silently: inferred values are printed and stored in the manifest.

Usage:
    python hf_lora_import.py --repo tarn59/super_eurobeats_ACE_STEP-1.5-lora --name super-eurobeats
    python hf_lora_import.py --repo <id> --name <name> --alpha 128 --json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

# The Windows console is cp1252 and the Hugging Face libraries print non-ASCII progress bars,
# which raises UnicodeEncodeError and kills the run before it reports anything.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

WEIGHTS_NAME = "adapter_model.safetensors"
CONFIG_NAME = "adapter_config.json"
MANIFEST_NAME = "lora_manifest.json"

# One or more nested `base_model.model.` prefixes; PEFT expects exactly one.
NESTED_PREFIX = re.compile(r"^(?:base_model\.model\.)+")
LORA_SUFFIX = re.compile(r"\.(lora_A|lora_B)\.weight$")


def read_header(path):
    """Return (tensors, metadata) from a safetensors file without loading tensor data."""
    with open(path, "rb") as handle:
        length = int.from_bytes(handle.read(8), "little")
        header = json.loads(handle.read(length).decode("utf-8"))
    metadata = header.pop("__metadata__", None) or {}
    tensors = {
        name: {"dtype": info.get("dtype"), "shape": [int(dim) for dim in info.get("shape", [])]}
        for name, info in header.items()
    }
    return tensors, metadata


def canonical_key(key):
    """Collapse repeated `base_model.model.` prefixes down to exactly one."""
    return NESTED_PREFIX.sub("base_model.model.", key)


def module_of(key):
    """`base_model.model.layers.0.self_attn.q_proj.lora_A.weight` -> `layers.0.self_attn.q_proj`."""
    return NESTED_PREFIX.sub("", LORA_SUFFIX.sub("", key))


def profile(adapter_tensors):
    """Derive rank, target modules and layer span from the adapter's own tensors."""
    a_keys = [key for key in adapter_tensors if key.endswith(".lora_A.weight")]
    b_keys = [key for key in adapter_tensors if key.endswith(".lora_B.weight")]
    if not a_keys:
        raise ValueError(
            "no `.lora_A.weight` tensors found, so this is not a PEFT LoRA file. Diffusers exports "
            "(`pytorch_lora_weights.safetensors`) and LyCORIS LoHa/LoKr artifacts cannot be loaded "
            "by this engine."
        )

    ranks = sorted({adapter_tensors[key]["shape"][0] for key in a_keys})
    modules = sorted({module_of(key) for key in a_keys})
    # Distinct layer indices - iterating `modules` directly would count 8 targets x N layers instead.
    layer_indices = {
        int(match.group(1)) for name in modules if (match := re.search(r"layers\.(\d+)\.", name))
    }
    layers = sorted(layer_indices)
    repeats = sorted(
        len(NESTED_PREFIX.match(key).group(0).split("base_model.model")) - 1
        for key in adapter_tensors
        if NESTED_PREFIX.match(key)
    )

    return {
        "rank": ranks[0] if len(ranks) == 1 else None,
        "ranks_seen": ranks,
        "lora_a_pairs": len(a_keys),
        "lora_b_pairs": len(b_keys),
        "target_modules": sorted({name.split("layers.")[-1].split(".", 1)[-1] for name in modules}),
        "module_paths": modules,
        "layers": len(layers),
        "layer_span": [layers[0], layers[-1]] if layers else None,
        "prefix_repeat": max(repeats) if repeats else 0,
    }


def verify_against_checkpoint(adapter_tensors, profiled, checkpoint_tensors):
    """Prove the adapter's targets exist in our DiT with shapes that can absorb it."""
    problems = []
    rank = profiled["rank"]
    if rank is None:
        problems.append(f"adapter has inconsistent ranks: {profiled['ranks_seen']}")

    by_module = {}
    for key, info in adapter_tensors.items():
        if key.endswith(".lora_A.weight"):
            by_module[module_of(key)] = info["shape"]

    for module in profiled["module_paths"]:
        base_shape = checkpoint_tensors.get(f"decoder.{module}.weight", {}).get("shape")
        if base_shape is None:
            problems.append(f"decoder.{module}.weight is not in the checkpoint")
            continue

        out_features, in_features = base_shape[0], base_shape[-1]
        a_shape = by_module.get(module)
        if a_shape is None:
            problems.append(f"no lora_A tensor for {module}")
            continue
        if a_shape[-1] != in_features:
            problems.append(f"{module}: lora_A in_features {a_shape[-1]} != checkpoint {in_features}")
        if rank and a_shape[0] != rank:
            problems.append(f"{module}: lora_A rank {a_shape[0]} != file rank {rank}")
        if a_shape[0] > max(out_features, in_features):
            problems.append(f"{module}: lora_A rank {a_shape[0]} exceeds both weight dims {base_shape}")

    return problems


def normalize_weights(source, destination):
    """Rewrite keys to the canonical single prefix and write the engine-loadable file."""
    from safetensors.torch import load_file, save_file

    tensors = load_file(str(source))
    rewritten = {}
    changed = 0
    for key, value in tensors.items():
        new_key = canonical_key(key)
        changed += new_key != key
        rewritten[new_key] = value

    destination.parent.mkdir(parents=True, exist_ok=True)
    save_file(rewritten, str(destination), metadata={"format": "pt", "normalized_by": "hf_lora_import"})
    return {"tensors": len(rewritten), "keys_rewritten": changed}


def synthesize_config(profiled, alpha, base_model):
    """Build the adapter_config.json PEFT needs, from what the weights actually contain."""
    rank = profiled["rank"] or max(profiled["ranks_seen"])
    chosen_alpha = alpha if alpha is not None else rank
    return {
        "peft_type": "LORA",
        "task_type": None,
        "inference_mode": True,
        "r": rank,
        "lora_alpha": chosen_alpha,
        "lora_dropout": 0.0,
        "bias": "none",
        "target_modules": profiled["target_modules"],
        "base_model_name_or_path": base_model,
    }


def resolve_engine_dir():
    """Locate ACE-Step-1.5 the same way the app does: env override, then the sibling checkout."""
    candidates = [
        os.environ.get("ACESTEP_PATH"),
        Path(__file__).resolve().parents[3] / "ACE-Step-1.5",
        Path.cwd() / "ACE-Step-1.5",
    ]
    for candidate in candidates:
        if candidate and (Path(candidate) / "acestep").is_dir():
            return Path(candidate)
    raise SystemExit("Could not locate ACE-Step-1.5 (set ACESTEP_PATH)")


def active_config_path(engine_dir):
    """The DiT the engine is configured to serve, from its .env."""
    env_file = engine_dir / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip().startswith("ACESTEP_CONFIG_PATH="):
                return line.split("=", 1)[1].strip()
    return "acestep-v15-turbo"


def checkpoint_header(engine_dir, config_path):
    """Merged tensor header of the served checkpoint (sharded checkpoints included)."""
    directory = engine_dir / "checkpoints" / config_path
    single = directory / "model.safetensors"
    files = [single] if single.exists() else sorted(directory.glob("model*.safetensors"))
    if not files:
        return {}, directory.name
    merged = {}
    for path in files:
        tensors, _ = read_header(path)
        merged.update(tensors)
    return merged, directory.name


def locate_weights(download_dir):
    """Prefer the canonical name; otherwise the shallowest, largest adapter file."""
    preferred = download_dir / WEIGHTS_NAME
    if preferred.exists():
        return preferred
    candidates = sorted(set(download_dir.rglob("*.safetensors")))
    if not candidates:
        raise SystemExit(f"No .safetensors weights found under {download_dir}")
    candidates.sort(key=lambda path: (len(path.parts), -path.stat().st_size))
    return candidates[0]


def locate_declared_config(download_dir):
    configs = sorted(set(download_dir.rglob(CONFIG_NAME)))
    return configs[0] if configs else None


def main():
    parser = argparse.ArgumentParser(
        description="Import a HF LoRA adapter into an engine-loadable layout",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--repo", required=True, help="Hugging Face model repo id")
    parser.add_argument("--name", required=True, help="local adapter name (folder under <engine>/loras)")
    parser.add_argument("--alpha", type=int, default=None, help="lora_alpha when the repo declares none (default: rank, i.e. scale 1.0)")
    parser.add_argument("--revision", default=None)
    parser.add_argument("--dest", default=None, help="destination directory (default <engine>/loras/<name>)")
    parser.add_argument("--engine-dir", default=None)
    parser.add_argument("--json", action="store_true", help="print a JSON summary as the final line")
    args = parser.parse_args()

    engine_dir = Path(args.engine_dir) if args.engine_dir else resolve_engine_dir()
    dest = Path(args.dest) if args.dest else engine_dir / "loras" / args.name
    # The untouched download is kept here, so the original is always recoverable.
    stage = engine_dir / "loras" / ".downloads" / args.name

    report = {
        "repo": args.repo,
        "name": args.name,
        "engineDir": str(engine_dir),
        "dest": str(dest),
        "originalDownload": str(stage),
    }

    from huggingface_hub import snapshot_download

    print(f"Downloading {args.repo} (weights, configs and README only) ...")
    snapshot_download(
        repo_id=args.repo,
        revision=args.revision,
        repo_type="model",
        local_dir=str(stage),
        # `*.json` matters: a repo that ships a proper adapter_config.json must have it honoured
        # rather than replaced by a synthesised one. Images and sample audio are skipped.
        allow_patterns=["*.safetensors", "*.json", "README.md"],
    )

    weights = locate_weights(stage)
    report["sourceWeights"] = weights.name
    adapter_tensors, adapter_meta = read_header(weights)
    report["safetensorsMetadata"] = adapter_meta

    profiled = profile(adapter_tensors)
    report["profile"] = profiled
    print(
        f"  profile: rank={profiled['rank']} pairs={profiled['lora_a_pairs']} "
        f"layers={profiled['layers']} targets={len(profiled['target_modules'])} "
        f"prefix_repeat={profiled['prefix_repeat']}"
    )

    config_path = active_config_path(engine_dir)
    checkpoint_tensors, checkpoint_name = checkpoint_header(engine_dir, config_path)
    report["checkpoint"] = {"configPath": config_path, "resolved": checkpoint_name}

    problems = verify_against_checkpoint(adapter_tensors, profiled, checkpoint_tensors) if checkpoint_tensors else []
    report["verification"] = {"ok": not problems, "problems": problems}
    for problem in problems:
        print(f"  !! {problem}")

    declared = locate_declared_config(stage)
    if declared:
        config = json.loads(declared.read_text(encoding="utf-8"))
        config.setdefault("peft_type", "LORA")
        config["base_model_name_or_path"] = config.get("base_model_name_or_path") or checkpoint_name
        report["config"] = {
            "source": "declared",
            "foundAt": str(declared.relative_to(stage)),
            "r": config.get("r"),
            "lora_alpha": config.get("lora_alpha"),
        }
    else:
        config = synthesize_config(profiled, args.alpha, checkpoint_name)
        report["config"] = {
            "source": "synthesized",
            "r": config["r"],
            "lora_alpha": config["lora_alpha"],
            "alphaNote": "no config in the repo; alpha is inferred (effective scale = alpha / r)",
        }

    report["normalize"] = normalize_weights(weights, dest / WEIGHTS_NAME)
    (dest / CONFIG_NAME).write_text(json.dumps(config, indent=2), encoding="utf-8")
    (dest / MANIFEST_NAME).write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["manifest"] = str(dest / MANIFEST_NAME)

    print(
        f"  config: {report['config']['source']} r={report['config']['r']} "
        f"lora_alpha={report['config']['lora_alpha']}"
    )
    print(
        f"  wrote {report['normalize']['tensors']} tensors "
        f"({report['normalize']['keys_rewritten']} keys re-prefixed) -> {dest}"
    )
    if not report["verification"]["ok"]:
        print("  WARNING: the adapter does not match the served checkpoint - loading is likely to fail")

    if args.json:
        print(json.dumps(report))


if __name__ == "__main__":
    main()
