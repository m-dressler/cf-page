export const bufferAsString = (buffer: string | BufferSource): string => {
  if (typeof buffer === "string") return buffer;
  else return new TextDecoder().decode(buffer);
};
