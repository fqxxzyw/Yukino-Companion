"""Run one v4 section after the paste cell verifies the Drive bundle."""

from zipfile import ZipFile


def run_postrun_section(section, bundle, bundle_sha):
    sections = {"5": "evaluate.py", "6": "export.py", "7.1": "compare.py", "7.2": "ui.py"}
    if section not in sections:
        raise ValueError('SECTION 请选择 "5"、"6"、"7.1" 或 "7.2"。')

    state = globals()
    needs_setup = state.get("_yukino_v4_setup_sha") != bundle_sha
    steps = ["setup.py"] if needs_setup else []
    if section == "7.2" and (needs_setup or state.get("_yukino_v4_compare_sha") != bundle_sha):
        steps.append("compare.py")
    steps.append(sections[section])
    with ZipFile(bundle) as archive:
        compiled = [(name, compile(archive.read(name), name, "exec")) for name in steps]

    for name, program in compiled:
        if name == "compare.py":
            state.pop("_yukino_v4_compare_sha", None)
        exec(program, state)
        if name == "setup.py":
            state["_yukino_v4_setup_sha"] = bundle_sha
            state.pop("_yukino_v4_compare_sha", None)
        elif name == "compare.py":
            state["_yukino_v4_compare_sha"] = bundle_sha


run_postrun_section(SECTION, v4_bundle, v4_bundle_sha)
