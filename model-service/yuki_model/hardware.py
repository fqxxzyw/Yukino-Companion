import csv
import importlib.util
import platform
import shutil
import subprocess
from pathlib import Path

import psutil


def detect():
    result = {
        "os": platform.system(),
        "ram_gib": round(psutil.virtual_memory().total / 1024**3, 2),
        "free_ram_gib": round(psutil.virtual_memory().available / 1024**3, 2),
        "cuda": False,
        "mps": False,
        "gpus": [],
        "native_cpu_bf16": False,
    }
    if Path("/proc/cpuinfo").exists():
        flags = Path("/proc/cpuinfo").read_text()
        result["native_cpu_bf16"] = "avx512_bf16" in flags or "amx_bf16" in flags
    if importlib.util.find_spec("torch"):
        import torch

        result["torch_version"] = torch.__version__
        result["cuda"] = torch.cuda.is_available()
        result["mps"] = bool(
            hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        )
        if result["cuda"]:
            for i in range(torch.cuda.device_count()):
                free, total = torch.cuda.mem_get_info(i)
                result["gpus"].append(
                    {
                        "index": i,
                        "name": torch.cuda.get_device_name(i),
                        "free_gib": round(free / 1024**3, 2),
                        "total_gib": round(total / 1024**3, 2),
                    }
                )
    if shutil.which("nvidia-smi"):
        try:
            p = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,memory.free",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            result["nvidia_driver"] = p.returncode == 0
            result["driver_gpus"] = []
            if p.returncode == 0:
                for row in csv.reader(p.stdout.splitlines()):
                    try:
                        result["driver_gpus"].append(
                            {
                                "name": row[0].strip(),
                                "total_gib": float(row[1]) / 1024,
                                "free_gib": float(row[2]) / 1024,
                            }
                        )
                    except (ValueError, IndexError):
                        pass
        except (OSError, subprocess.TimeoutExpired):
            result["nvidia_driver"] = False
    return result


def device(info, requested="auto"):
    if requested not in {"auto", "cpu", "cuda", "mps"}:
        raise ValueError("device must be auto/cpu/cuda/mps")
    if requested == "cuda" and not info["cuda"]:
        raise RuntimeError(
            "CUDA runtime unavailable; check PyTorch build and NVIDIA driver"
        )
    if requested == "mps" and not info["mps"]:
        raise RuntimeError("MPS unavailable")
    if requested != "auto":
        return requested
    # Same weights on every device. Any usable GPU gets priority; memory fallback is separate.
    return "cuda" if info["cuda"] else "mps" if info["mps"] else "cpu"
