"""Export already merged HF weights using an explicitly supplied llama.cpp checkout."""

import argparse
import subprocess
import sys
from pathlib import Path

from yuki_model.io import file_sha, save_json

p = argparse.ArgumentParser()
p.add_argument("--llama-cpp", type=Path, required=True)
p.add_argument("--merged", type=Path, required=True)
p.add_argument("--quantizer", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
fp16 = a.output / "yukino-f16.gguf"
q4 = a.output / "yukino-q4_k_m.gguf"
if fp16.exists() or q4.exists():
    p.error("Output GGUF already exists")
subprocess.run(
    [
        sys.executable,
        str(a.llama_cpp / "convert_hf_to_gguf.py"),
        str(a.merged),
        "--outfile",
        str(fp16),
        "--outtype",
        "f16",
    ],
    check=True,
)
subprocess.run([str(a.quantizer.resolve()), str(fp16), str(q4), "Q4_K_M"], check=True)
commit = subprocess.check_output(
    ["git", "-C", str(a.llama_cpp), "rev-parse", "HEAD"], text=True
).strip()
save_json(
    a.output / "manifest.json",
    {
        "llama_cpp_commit": commit,
        "file": q4.name,
        "sha256": file_sha(q4),
        "quantization": "Q4_K_M",
        "same_weights_cpu_gpu": True,
    },
)
print(q4)
