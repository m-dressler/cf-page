export const bufferAsString = (buffer: string | BufferSource): string => {
  if (typeof buffer === "string") return buffer;
  else return new TextDecoder().decode(buffer);
};

/** Converts any `ArrayBuffer` or `ArrayBufferView` into a `Uint8Array<ArrayBuffer>` */
export const toUint8Array = (
  array: ArrayBufferView<ArrayBufferLike> | ArrayBuffer,
): Uint8Array<ArrayBuffer> => {
  if (array instanceof ArrayBuffer) return new Uint8Array(array);

  // If already full buffer and of correct type, return as-is
  if (
    array.byteOffset === 0 &&
    array.byteLength === array.buffer.byteLength &&
    !(array.buffer instanceof SharedArrayBuffer)
  ) return new Uint8Array(array.buffer);

  // Otherwise, copy contents into a fresh ArrayBuffer
  const copy = new Uint8Array(array.byteLength);
  copy.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return copy as Uint8Array<ArrayBuffer>;
};
