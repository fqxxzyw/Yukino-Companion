export const noModelId = 'none';

const sources = [
  ['yukino-04-v1', '蓝色花纹和服', 'Yukino04_UVPartsClean_PORTABLE.glb', 10005444, '9ef2b66ab0bff9c1d93750231b0da31731f98a00c5b8c4bac170fc3c9dbf3689'],
  ['yukino-03-v1', '白色连体泳装蓝蝴蝶结', 'Yukino03_UVDomainRepair.glb', 9885224, '85883a14231a7305b9202ccd179f4e3fe1d7a007ff57d7ea41542e04d5f9175d'],
  ['yukino-07-v1', '原校服黄背心（季节未标注）', 'Yukino07_UVDomainRepair.glb', 9882096, '35ee6553bc0023053cd40b830eb9603d8107904531c4014f79433ff3f8013ae5'],
  ['yukino-02-v1', '蓝色开衫贝雷帽', 'Yukino02_UVDomainRepair.glb', 11413596, 'f5c034e7331ebae979081b46b6aa725a148d59a01d8cf7b1eadede3004df1d8b'],
  ['yukino-05-v1', '黑色蕾丝裙', 'Yukino05_UVDomainRepair.glb', 13369772, 'e172b3718f4199e10ecd7f5568cd481b041133223a6f3c1c3056d4499e162c59'],
  ['yukino-06-v1', '黑白女仆红蝴蝶结', 'Yukino06_UVPartsClean_PORTABLE.glb', 11691392, 'b2fd939ecbeffab7844909b05f361895aac291e54c16b5cfb1715ee9d8c0a3f6'],
  ['yukino-07-walk14-preview', '黄背心校服·原地慢步（评审版）', 'Yukino07_CMUWalk14_V6_REVIEW.glb', 10175144, '44cdaf1b970662e0a1c3aac1545e515047bf1cfb6bed0ac83b4d2c8b16a88866'],
] as const;

export const models = sources.map(([id, label, filename, bytes, sha256]) => ({
  id, label, filename, bytes, sha256,
  url: `/models/${filename}`,
  path: `public/characters/${filename}`,
}));
