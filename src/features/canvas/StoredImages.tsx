import type { StoredImage } from "../../domain/images";

export const StoredImages = ({ images }: { images: StoredImage[] }) => <div className="stored-images">{images.map((image, index) => {
  const url = `data:${image.mimeType};charset=utf-8,${encodeURIComponent(image.source)}`;
  return <figure key={index}>
    <img src={url} alt={image.name} draggable={false} />
    <figcaption><span>{image.name}</span><a href={url} download={`${image.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}.svg`}>Download image</a></figcaption>
  </figure>;
})}</div>;
