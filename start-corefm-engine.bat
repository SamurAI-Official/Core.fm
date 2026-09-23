@echo off
REM ---------------------------------------------------------------------------
REM  Core.fm engine launcher - ACE-Step 1.5 API on port 8001
REM
REM  CRITICAL: --use_flash_attention false is REQUIRED on this machine.
REM
REM  The installed flash-attn is a third-party Windows build
REM  (flash_attn-2.8.2+cu128torch2.7.1...win_amd64.whl from
REM  sdbds/flash-attention-for-windows). With it enabled the engine dies during
REM  model init with a native access violation, recorded by WER as:
REM      python.exe, module c10.dll, exception 0xc0000005, fault offset 0x85bb4
REM  This reproduced identically with int8 on/off, torch.compile on/off, and
REM  with the GPU completely free. Switching to sdpa makes init stable.
REM
REM  Do NOT "fix" this by disabling CPU offload - that pins the GPU and the
REM  engine never launches. Leave the offload defaults alone.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
python_embeded\python.exe acestep\acestep_v15_pipeline.py ^
  --port 8001 ^
  --enable-api ^
  --backend pt ^
  --server-name 127.0.0.1 ^
  --use_flash_attention false ^
  --quantization none

REM ---------------------------------------------------------------------------
REM  Quantization: "none" is deliberate (added 2026-09-20).
REM
REM  On this GPU tier the engine auto-selects int8_weight_only, and a QUANTIZED
REM  DiT cannot accept adapters - AceStepHandler.add_lora refuses with
REM  "LoRA loading is not supported on quantized models". So LoRA/LoHa/LoKr
REM  loading was impossible on every default launch.
REM
REM  Unquantized inference fits easily here: ~1.5GB VRAM idle and ~5GB with the
REM  adapter loaded, because model offloading is on. The engine's own training
REM  handlers already switch to a "training preset" that disables quantization,
REM  so this matches what training does anyway.
REM
REM  To go back to the int8 default (lower VRAM, no adapter support), delete the
REM  --quantization none line. "none" is only expressible because
REM  acestep_v15_pipeline.py accepts it as an alias for None.
REM ---------------------------------------------------------------------------
