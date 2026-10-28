function deepFreeze(value){for(const item of Object.values(value))if(item&&typeof item==='object')deepFreeze(item);return Object.freeze(value);}
// Exact optional review capability. Never part of the ordinary wardrobe catalog.
export const BLINK_REVIEW_V5 = deepFreeze({
  "schemaVersion": 1,
  "status": "isolated-review",
  "assetSha256": "b8bac4203f9fe7c195ab57158cae44b18f6fcd4260b0a72b886bbd775731beac",
  "bothEyes": true,
  "channels": [
    {
      "mesh": "M06_MouthLocalSplit_Prototype",
      "morph": "eye_blink_l",
      "eye": "left",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype",
      "morph": "eye_blink_r",
      "eye": "right",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype_10",
      "morph": "eye_blink_l",
      "eye": "left",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype_10",
      "morph": "eye_blink_r",
      "eye": "right",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype_14",
      "morph": "eye_blink_r",
      "eye": "right",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype_15",
      "morph": "eye_blink_l",
      "eye": "left",
      "closedWeight": 1
    },
    {
      "mesh": "M06_MouthLocalSplit_Prototype_15",
      "morph": "eye_blink_r",
      "eye": "right",
      "closedWeight": 1
    }
  ],
  "equalBilateralWeightsOnly": true,
  "warning": "眼角仍有细微皮肤交叠/折痕；只供隔离审阅，不是无碰撞生产资产。"
});
export const BLINK_REVIEW_MODEL = deepFreeze({
  "id": "yukino-06-blink-v5-review",
  "characterId": "yukino",
  "label": "白裙·双眼眨眼（隔离审阅）",
  "version": "blink-bilateral-v5-review",
  "ready": false,
  "status": "isolated-review",
  "url": "../review-assets/Yukino06_BilateralBlink_REVIEW.glb",
  "bytes": 12042464,
  "sha256": "b8bac4203f9fe7c195ab57158cae44b18f6fcd4260b0a72b886bbd775731beac",
  "clips": {
    "Idle_Breathe": {
      "loop": true,
      "duration": 4.0
    },
    "Listen_Attentive": {
      "loop": true,
      "duration": 4.0
    },
    "Look_Left": {
      "loop": false,
      "duration": 3.0
    },
    "Look_Right": {
      "loop": false,
      "duration": 3.0
    },
    "Nod_Subtle": {
      "loop": false,
      "duration": 2.4
    },
    "Think_Downcast": {
      "loop": false,
      "duration": 4.0
    }
  },
  "mouth": {
    "canonical_name": "mouth_open_small",
    "recommended_dialogue_range": [
      0,
      0.3
    ],
    "default_zero_closed": true,
    "synchronize_all_meshes_with_same_morph_name": false,
    "aliases_not_additive": {},
    "audio_driven": false,
    "combined_targets_not_automatically_validated": true
  },
  "blink": false,
  "hairPhysics": false,
  "defaultClip": "Idle_Breathe",
  "limits": [
    "审阅版资源，未完成 Windows 原生验收",
    "无眨眼与头发物理"
  ],
  "bundled": false,
  "outfitGroup": "yukino-06",
  "thumbnail": "./characters/thumbnails/yukino-06.png",
  "thumbnailSha256": "93f1c03884d38a602be4994442af82ea9586df080d98987caa22b71007bdfd98",
  "thumbnailSourceSha256": "b2fd939ecbeffab7844909b05f361895aac291e54c16b5cfb1715ee9d8c0a3f6",
  "hold": true,
  "reviewOnly": true,
  "blinkContract": {
    "schemaVersion": 1,
    "status": "isolated-review",
    "assetSha256": "b8bac4203f9fe7c195ab57158cae44b18f6fcd4260b0a72b886bbd775731beac",
    "bothEyes": true,
    "channels": [
      {
        "mesh": "M06_MouthLocalSplit_Prototype",
        "morph": "eye_blink_l",
        "eye": "left",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype",
        "morph": "eye_blink_r",
        "eye": "right",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype_10",
        "morph": "eye_blink_l",
        "eye": "left",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype_10",
        "morph": "eye_blink_r",
        "eye": "right",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype_14",
        "morph": "eye_blink_r",
        "eye": "right",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype_15",
        "morph": "eye_blink_l",
        "eye": "left",
        "closedWeight": 1
      },
      {
        "mesh": "M06_MouthLocalSplit_Prototype_15",
        "morph": "eye_blink_r",
        "eye": "right",
        "closedWeight": 1
      }
    ],
    "equalBilateralWeightsOnly": true,
    "warning": "眼角仍有细微皮肤交叠/折痕；只供隔离审阅，不是无碰撞生产资产。"
  }
});
