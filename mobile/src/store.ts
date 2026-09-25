// Projects and their audio live in the web view's IndexedDB: no plugin, and a WAV plays straight
// from its stored Blob. Sending the same project again replaces it, audio and all.
import type { Backup, Preferences, Project } from './backup.ts';

export interface Saved { project: Project; prefs: Preferences; importedAt: string }
let opened: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('script-glow', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('projects', { keyPath: 'project.id' }); request.result.createObjectStore('audio'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

async function run<T>(mode: IDBTransactionMode, work: (projects: IDBObjectStore, audio: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const tx = (await db()).transaction(['projects', 'audio'], mode);
  const request = work(tx.objectStore('projects'), tx.objectStore('audio'));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request ? request.result : (undefined as T));
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('The phone could not save this project.'));
  });
}

export const listProjects = () => run<Saved[]>('readonly', projects => projects.getAll());
export const getAudio = (id: string, name: string) => run<Blob | undefined>('readonly', (_, audio) => audio.get(`${id}/${name}`));
export const savePrefs = (saved: Saved) => run('readwrite', projects => { projects.put(saved); });

export async function removeProject(id: string): Promise<void> {
  await run('readwrite', (projects, audio) => { projects.delete(id); audio.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)); });
}

// The actor's phone-side settings survive a re-send; everything else comes from the Mac.
export async function saveBackup({ project, audio }: Backup, previous?: Saved): Promise<Saved> {
  const prefs = { ...project.preferences, ...(previous ? pick(previous.prefs) : {}) };
  const saved: Saved = { project, prefs, importedAt: new Date().toISOString() };
  await run('readwrite', (projects, store) => {
    store.delete(IDBKeyRange.bound(`${project.id}/`, `${project.id}/￿`));
    for (const [name, blob] of audio) store.put(blob, `${project.id}/${name}`);
    projects.put(saved);
  });
  return saved;
}
const pick = ({ mode, rate, hide, hint, wait, autoContinue, holdMs, loop }: Preferences) => ({ mode, rate, hide, hint, wait, autoContinue, holdMs, loop });
