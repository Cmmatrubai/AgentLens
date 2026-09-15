import {
  mkdir,
  lstat,
  open,
  rename,
  unlink,
  readdir,
  chmod,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const LIMIT = 16 * 1024 * 1024;
function filename(root, name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.json$/.test(name))
    throw Error("invalid_private_path");
  return join(root, name);
}
async function directory(root, create = false) {
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const s = await lstat(root);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw Error("unsafe_private_directory");
    if (create) await chmod(root, 0o700);
    return true;
  } catch (e) {
    if (!create && e.code === "ENOENT") return false;
    throw e;
  }
}
export async function privateRead(root, name) {
  const path = filename(root, name);
  if (!(await directory(root))) return null;
  let f;
  try {
    f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await f.stat();
    if (!s.isFile() || s.size > LIMIT) throw Error("invalid_private_file");
    return JSON.parse(await f.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await f?.close();
  }
}
export async function privateWrite(root, name, value) {
  const path = filename(root, name);
  await directory(root, true);
  try {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink()) throw Error("unsafe_private_file");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const data = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(data) > LIMIT) throw Error("private_file_too_large");
  const temp = join(root, ".write-" + randomUUID());
  let f;
  try {
    f = await open(temp, "wx", 0o600);
    await f.writeFile(data);
    await f.sync();
    await f.close();
    f = null;
    await rename(temp, path);
  } finally {
    await f?.close();
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
export async function privateRemove(root, name) {
  const path = filename(root, name);
  if (!(await directory(root))) return;
  try {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink()) throw Error("unsafe_private_file");
    await unlink(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
export async function privateList(root, kind = "job") {
  if (kind !== "job" && kind !== "support") throw Error("invalid_private_kind");
  const pattern = new RegExp(`^${kind}-[a-f0-9-]{36}\\.json$`);
  return (await directory(root))
    ? (await readdir(root)).filter((n) => pattern.test(n))
    : [];
}
