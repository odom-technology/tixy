/* Profile cosmetics made by an image model before rev. 2: avatar portraits,
   banners, badge images and level emblems. Nothing in this folder is
   offered any more. A player who bought one keeps it, owns it, and can still
   equip it, so the files stay in public/cosmetics and every old path
   returns 200.

   `isGeneratedProfileAsset` is the test the prize counter uses to take them
   off sale. scripts/list-generated-cosmetics.ts prints the item ids. */

const GENERATED_DIRS = ['/cosmetics/avatars/', '/cosmetics/banners/', '/cosmetics/badges/', '/cosmetics/levels/'];

const IMAGE_KEYS = ['imageUrl', 'image', 'src', 'url'];

/** Does this asset_ref point at a generated image? */
export function isGeneratedProfileAsset(assetRef: Record<string, unknown> | null | undefined): boolean {
  if (!assetRef) return false;
  return IMAGE_KEYS.some((key) => {
    const value = assetRef[key];
    return typeof value === 'string' && GENERATED_DIRS.some((dir) => value.startsWith(dir));
  });
}
