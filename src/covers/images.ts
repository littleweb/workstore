import { imageSource, referenceImage } from "../comics/images";
export { imageSource };
export async function pngReference(src: string) {
  // The unified gateway accepts PNG, while the bundled style gallery uses WebP.
  return referenceImage({ src });
}
