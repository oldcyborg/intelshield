// Records the tutorial videos, one per role, into out/. The demo company is rebuilt first, so each run starts
// from the same story: the guard checks in, patrols and reports; the leader and the manager act on it; HR hires;
// the accountant pays everyone and bills the clients.
//   docker compose --profile video run --rm video                       all five, in story order
//   docker compose --profile video run --rm video record.mjs bao-ve     only some (names below)
//   docker compose --profile video run --rm -e QA=1 video               a fast check of every flow, no recording
import { issues, makePhotos, QA, snapshotFailure } from './lib.mjs';
import { prepare } from './setup.mjs';

const ORDER = ['bao-ve', 'truong-doi', 'quan-ly', 'hr', 'ke-toan'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;
const unknown = wanted.filter((w) => !ORDER.includes(w));
if (unknown.length) throw new Error(`Không có vai trò: ${unknown.join(', ')} (chọn trong ${ORDER.join(', ')})`);

const ctx = await prepare();
const photos = await makePhotos('/tmp/photos');
for (const name of ORDER.filter((o) => wanted.includes(o))) {
  console.log(`● ${QA ? 'Chạy thử' : 'Quay'}: ${name}`);
  const { default: scene } = await import(`./scenes/${name}.mjs`);
  try {
    await scene(ctx, photos);
  } catch (error) {
    await snapshotFailure(name);
    // QA keeps going: one broken role must not hide what the next ones hit.
    if (!QA) throw error;
    issues.push({ where: name, kind: 'DỪNG KỊCH BẢN', detail: String(error.message).split('\n').slice(0, 3).join(' | ') });
  }
}

if (QA) {
  console.log(`\n===== QA: ${issues.length} vấn đề =====`);
  for (const i of issues) console.log(`[${i.kind}] ${i.where}\n    ${i.detail}`);
}
