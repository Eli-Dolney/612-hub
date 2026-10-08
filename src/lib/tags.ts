import { parseBlob } from "music-metadata";

export type Tags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration?: number;
  picture?: Blob;
};

export async function readTags(file: File): Promise<Tags> {
  try {
    const meta = await parseBlob(file, { duration: false });
    const pic = meta.common.picture?.[0];
    let picture: Blob | undefined;
    if (pic?.data) {
      const bytes = pic.data instanceof Uint8Array ? pic.data : new Uint8Array(pic.data as ArrayLike<number>);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      picture = new Blob([copy], { type: pic.format || "image/jpeg" });
    }
    return {
      title: meta.common.title,
      artist: meta.common.artist,
      album: meta.common.album,
      albumArtist: meta.common.albumartist,
      genre: meta.common.genre?.[0],
      year: meta.common.year,
      trackNo: meta.common.track?.no ?? undefined,
      discNo: meta.common.disk?.no ?? undefined,
      duration: meta.format.duration,
      picture,
    };
  } catch {
    return {};
  }
}
