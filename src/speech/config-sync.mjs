// Keep edits made in the settings panel while background setup reports new paths.
export class VoiceConfigSync {
  constructor(defaults) {
    this.defaults = {...defaults};
    this.value = {...defaults};
    this.dirty = new Map();
    this.revision = 0;
  }
  edit(patch) {
    const next = {...this.value};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in this.defaults) || Object.is(next[key], value)) continue;
      next[key] = value;
      this.dirty.set(key, ++this.revision);
    }
    return this.value = next;
  }
  receive(remote) {
    const next = {...this.defaults, ...remote};
    for (const key of this.dirty.keys()) next[key] = this.value[key];
    return this.value = next;
  }
  pending() {
    const versions = new Map(this.dirty);
    return {versions, patch:Object.fromEntries([...versions.keys()].map(key => [key, this.value[key]]))};
  }
  acknowledge(snapshot) {
    for (const [key, version] of snapshot.versions) {
      if (this.dirty.get(key) === version) this.dirty.delete(key);
    }
  }
}
