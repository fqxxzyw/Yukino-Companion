"""Package the v4 evaluation, export and comparison cells with runtime setup."""

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


NOTEBOOKS = Path(__file__).resolve().parents[1] / "notebooks"


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected one occurrence of {old!r} in the notebook cell")
    return source.replace(old, new, 1)


def build_bundle(destination):
    notebook = json.loads((NOTEBOOKS / "yukino-a100-chapters-v4.ipynb").read_text(encoding="utf-8"))
    cells = {
        cell["id"]: "".join(cell["source"])
        for cell in notebook["cells"] if cell["cell_type"] == "code"
    }
    evaluate = replace_once(
        cells["evaluate"],
        'verify_run(persona_output, "distill_sft")\n',
        'training = verify_run(persona_output, "distill_sft")\n'
        'manifest_path = prepared / "manifest.json"\n'
        'if digest(manifest_path) != training["data"]["data_manifest_sha256"]:\n'
        '    raise RuntimeError("评测数据清单与本轮训练时使用的版本不符。")\n'
        'evaluation_artifacts = load_json(manifest_path)["artifacts"]\n',
    )
    evaluate = replace_once(
        evaluate,
        '    output = drive_runs / "evaluation" / persona_output.name / label\n',
        '    for filename in (f"{name}-prompts.jsonl", f"{name}.jsonl"):\n'
        '        if digest(prepared / filename) != evaluation_artifacts[filename]:\n'
        '            raise RuntimeError(f"云盘评测数据校验失败：{filename}")\n'
        '    output = drive_runs / "evaluation" / persona_output.name / label\n',
    )
    export = replace_once(
        cells["export"],
        '    if not export_path.exists():\n',
        '    if export_path.exists() and not (export_path / "manifest.json").is_file():\n'
        '        raise RuntimeError(f"云盘已有不完整的导出目录，请先重命名它再重试：{export_path}")\n'
        '    if not export_path.exists():\n'
        '        print("正在用 CPU 合并和转换模型，完成后将 GGUF 写入云盘。", flush=True)\n',
    )
    export = replace_once(
        export,
        'run("-m", "pip", "install", "numpy==2.2.6", "sentencepiece==0.2.1", "protobuf==4.25.8")',
        'run("-m", "pip", "--python", python, "install",\n'
        '            "numpy==2.2.6", "sentencepiece==0.2.1", "protobuf==4.25.8",\n'
        '            interpreter=sys.executable, log=drive_runs / "gguf-export.log")',
    )
    compare = replace_once(
        cells["compare-setup"],
        'if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():\n'
        '            raise RuntimeError("对比需要支持 BF16 的 CUDA GPU。")',
        'if not torch.cuda.is_available():\n'
        '            raise RuntimeError("请先将 Colab 运行时切换为 GPU，例如 T4 或 A100。")\n'
        '        inference_dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported(including_emulation=False)\n'
        '                           else torch.float16)',
    )
    compare = replace_once(compare, "torch_dtype=torch.bfloat16,", "torch_dtype=inference_dtype,")
    ui = cells["compare-ui"]
    setup = (NOTEBOOKS / "yukino_v4_postrun_setup.py").read_text(encoding="utf-8")
    setup = 'print("正在检查云盘上的底座和两份 LoRA。首次读取约 3 GB，请等待。", flush=True)\n' + setup
    dispatch = (NOTEBOOKS / "yukino_v4_postrun_dispatch.py").read_text(encoding="utf-8")
    programs = {
        "dispatch.py": dispatch,
        "setup.py": setup,
        "evaluate.py": evaluate,
        "export.py": export,
        "compare.py": compare,
        "ui.py": ui,
    }
    for name, program in programs.items():
        compile(program, name, "exec")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as bundle:
        for name, program in programs.items():
            bundle.writestr(name, program.encode("utf-8"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    build_bundle(parser.parse_args().destination)
