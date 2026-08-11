import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderAllSkills, runRenderSkills } from '../../src/core/cli/render-skills.js';

function withTmpDirs(fn: (skillsDir: string, outDir: string) => Promise<void> | void) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), 'ih-render-skills-'));
    const skillsDir = join(root, 'skills');
    const outDir = join(root, 'out');
    mkdirSync(skillsDir, { recursive: true });
    try {
      await fn(skillsDir, outDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeSkill(skillsDir: string, name: string, body = 'Body text.'): void {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill ${name}\n---\n\n${body}\n`, 'utf8');
}

test(
  'renderAllSkills writes one SKILL.md per skill per host',
  withTmpDirs(async (skillsDir, outDir) => {
    writeSkill(skillsDir, 'alpha');
    writeSkill(skillsDir, 'beta');
    const written = await renderAllSkills({ skillsDir, outDir, hosts: ['claude', 'codex'] });
    assert.equal(written.length, 4);
    const content = readFileSync(join(outDir, 'codex', 'alpha', 'SKILL.md'), 'utf8');
    assert.match(content, /name: alpha/);
    assert.match(content, /"host":"codex"/);
  }),
);

test(
  'renderAllSkills skips non-skill directories (no SKILL.md) without erroring',
  withTmpDirs(async (skillsDir, outDir) => {
    writeSkill(skillsDir, 'real-skill');
    mkdirSync(join(skillsDir, 'not-a-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'not-a-skill', 'README.md'), 'nope', 'utf8');
    const written = await renderAllSkills({ skillsDir, outDir, hosts: ['claude'] });
    assert.equal(written.length, 1);
  }),
);

test(
  'renderAllSkills throws (does not silently drop) on a skill with malformed frontmatter',
  withTmpDirs(async (skillsDir, outDir) => {
    mkdirSync(join(skillsDir, 'broken'), { recursive: true });
    writeFileSync(join(skillsDir, 'broken', 'SKILL.md'), 'no frontmatter here at all', 'utf8');
    await assert.rejects(() => renderAllSkills({ skillsDir, outDir, hosts: ['claude'] }));
  }),
);

test('runRenderSkills returns a usage error without skillsDir/outDir', async () => {
  assert.equal(await runRenderSkills([]), 1);
});

test('runRenderSkills fails (exit 1) when every requested host is invalid', async () => {
  const code = await runRenderSkills(['skills', 'out', '--hosts=nope,bogus']);
  assert.equal(code, 1);
});

test(
  'runRenderSkills renders every real skill in this repo for a real host, end to end',
  withTmpDirs(async (_skillsDir, outDir) => {
    const code = await runRenderSkills(['skills', outDir, '--hosts=codex']);
    assert.equal(code, 0);
    // This repo ships 9 skills as of this pass; assert "at least" so new skills don't break this test.
    const { readdirSync } = await import('node:fs');
    const rendered = readdirSync(join(outDir, 'codex'));
    assert.ok(rendered.length >= 9, `expected at least 9 rendered skills, got ${rendered.length}`);
  }),
);
