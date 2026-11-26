"""Run the same three small Python maintenance tasks with ShadowCode and Aider.

Use a local OpenAI-compatible inference endpoint. Artifacts stay in a new
directory supplied by the caller. Each run starts at the same fixture commit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

CASES = [
    ("bug-fix", {"maths.py": "def percent(part, total):\n    return total / part * 100\n"},
     "Correct percent(part, total). Return the percentage of total represented by part, and return zero when total is zero.",
     "from maths import percent\nassert percent(3, 12) == 25 and percent(1, 0) == 0 and percent(0, 4) == 0"),
    ("multi-file", {"units.py": "FACTORS = {'m': 1, 'cm': 0.01}\n",
                    "convert.py": "from units import FACTORS\n\ndef metres(n, unit):\n    return n * FACTORS[unit]\n"},
     "Extend the units table with millimetres. Make metres accept mixed case and surrounding whitespace in the unit name. Preserve the existing units and KeyError for unknown units.",
     "from units import FACTORS\nfrom convert import metres\nassert FACTORS['mm'] == .001 and metres(2000, ' Mm ') == 2 and metres(25, 'CM') == .25\ntry: metres(1,'missing')\nexcept KeyError: pass\nelse: raise AssertionError()"),
    ("test-diagnosis", {"labels.py": "def names(items):\n    return [item.strip() for item in items if item]\n",
                        "test_labels.py": "from labels import names\n\ndef check():\n    assert names([' red ', '   ', '', 'blue']) == ['red', 'blue']\n\nif __name__ == '__main__':\n    check()\n"},
     "Run python3 test_labels.py and diagnose the failure. Fix labels.py, preserve ordering and duplicates, and keep the test unchanged.",
     "from labels import names\nassert names([' ', ' x ','x',' z']) == ['x','x','z'] and names([]) == []")
]


def execute(args, cwd, log, env=None, timeout=300):
    with log.open('w') as stream:
        started = time.monotonic()
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            code = 124
        return code, round(time.monotonic() - started, 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('output', 'endpoint', 'model', 'shadowcode', 'aider'):
        parser.add_argument('--' + arg, required=True)
    opt = parser.parse_args()
    out = Path(opt.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    results = []
    for index, (case, files, request, assertions) in enumerate(CASES):
        source = out / case / 'source'
        source.mkdir(parents=True)
        for name, contents in files.items():
            (source / name).write_text(contents)
        git_env = dict(os.environ, GIT_AUTHOR_DATE='2026-01-01T00:00:00Z', GIT_COMMITTER_DATE='2026-01-01T00:00:00Z')
        for args in (['init','-qb','main'], ['add','.'], ['-c','user.name=Benchmark','-c','user.email=bench@example.invalid','-c','commit.gpgsign=false','commit','-qm','Fixture']):
            subprocess.run(['git', *args], cwd=source, env=git_env, check=True)
        commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=source, text=True).strip()
        def check(path):
            return subprocess.run([sys.executable,'-B','-c',assertions], cwd=path, capture_output=True).returncode == 0
        if check(source):
            raise RuntimeError('Broken baseline unexpectedly passes')
        for product in (['ShadowCode','Aider'] if index % 2 == 0 else ['Aider','ShadowCode']):
            dest = out / case / product
            project = dest / 'repo'
            shutil.copytree(source, project)
            env = os.environ.copy()
            prompt = request + ' Inspect the files and implement the change in this project.'
            if product == 'ShadowCode':
                base = [opt.shadowcode, '--profile',str(dest/'profile'),'--workspace',str(project),'--json']
                for step, args in [('trust',['trust']), ('register',['models','--use',opt.model,'--provider','ollama','--endpoint',opt.endpoint,'--context-limit','16384'])]:
                    code, _ = execute(base+args,project,dest/(step+'.log'))
                    if code: raise RuntimeError(f'{case} {step} failed. See {dest}')
                cmd = base + ['run','--approval','approve',prompt]
            else:
                env.update(OPENAI_API_KEY='local-inference', AIDER_ANALYTICS='false', LITELLM_LOCAL_MODEL_COST_MAP='True')
                cmd = [opt.aider,'--model','openai/'+opt.model,'--openai-api-base',opt.endpoint,
                       '--edit-format','whole','--map-tokens','0','--no-analytics','--no-check-update','--no-show-model-warnings',
                       '--no-gitignore','--yes-always','--no-suggest-shell-commands','--message',prompt,*files]
            rc, elapsed = execute(cmd,project,dest/'run.log',env)
            original_tests = all((project/name).exists() and (project/name).read_bytes()==contents.encode()
                                 for name,contents in files.items() if name.startswith('test_'))
            row = dict(case=case, product=product, model=opt.model, fixture_commit=commit,
                       instruction_sha256=hashlib.sha256(prompt.encode()).hexdigest(), exit_code=rc,
                       elapsed_seconds=elapsed, acceptance_pass=check(project) and original_tests,
                       human_corrections=0, provider_fee_usd=0)
            results.append(row)
            (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
            print(json.dumps(row),flush=True)


if __name__ == '__main__':
    main()
