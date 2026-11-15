import {Euler, Matrix4, Quaternion, Vector3} from '../../Simple-Trail/node_modules/three/build/three.module.js';

// diamond_sword -> item/handheld, firstperson_righthand:
// https://github.com/InventivetalentDev/minecraft-assets/blob/1.21.5/assets/minecraft/models/item/handheld.json
// ItemInHandRenderer.applyItemArmTransform supplies the camera-space offset:
// https://github.com/mahtomedi/minecraft/blob/main/src/main/java/net/minecraft/client/renderer/ItemInHandRenderer.java
// Bedrock's arm pose and rightitem pivot correction:
// https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/player_firstperson.animation.json
export function firstPersonSwordHold(source, model) {
  const result = structuredClone(source);
  const rad = Math.PI / 180;
  const bedrockRotation = ([x, y, z]) => new Matrix4().makeRotationFromEuler(
    new Euler(-x * rad, -y * rad, z * rad, 'ZYX')
  );
  const translation = values => new Matrix4().makeTranslation(...values);
  const rounded = values => values.map(value => Number(value.toFixed(6)));

  // Work in Blockbench coordinates (Bedrock model X mirrored). Reference is
  // the vanilla standing player: scale 0.9375, eye height 1.62 blocks.
  // rightarm pivot [5,22,0] + first-person translation [-13.5,-10,12].
  // rightitem pivot [6,15,1] + empty_hand's [0,0,-1] gives offset [1,-7,0].
  const arm = bedrockRotation([95, -45, 115]);
  const anchor = new Vector3(-8.5, 12, 12)
    .add(new Vector3(1, -7, 0).applyMatrix4(arm));
  const binding = arm.clone().setPosition(anchor);
  const unitsPerBlock = 16 / 0.9375;

  // Centered Java generated-item pixels -> this model's texture_mesh.
  // Texture-mesh origin/rotation conventions follow Blockbench's Bedrock codec:
  // https://github.com/JannisX11/blockbench/blob/master/js/formats/bedrock/bedrock.js
  // https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/texture_mesh.js
  const mesh = model.bones.find(bone => bone.name === 'sword').texture_meshes[0];
  const texture = translation([-mesh.position[0], -mesh.position[1], mesh.position[2]])
    .multiply(bedrockRotation(mesh.rotation))
    .multiply(translation([-model.description.texture_width / 2, -0.5, model.description.texture_height / 2]))
    .multiply(new Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 1));

  // Java display rotations use XYZ; translations are measured in 1/16 blocks.
  const javaPose = translation([0.56 + 1.13 / 16, -0.52 + 3.2 / 16, -0.72 + 1.13 / 16])
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(0, -90 * rad, 25 * rad, 'XYZ')))
    .multiply(new Matrix4().makeScale(0.68 / 16, 0.68 / 16, 0.68 / 16));
  const target = translation([0, 1.62 * unitsPerBlock, 0])
    .multiply(new Matrix4().makeScale(-unitsPerBlock, unitsPerBlock, -unitsPerBlock))
    .multiply(javaPose);
  const local = binding.invert().multiply(target).multiply(texture.invert());
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  local.decompose(position, rotation, scale);
  const angles = new Euler().setFromQuaternion(rotation, 'ZYX');
  result.animations['animation.sword_trail.hold_first_person'].bones.sword = {
    rotation: rounded([-angles.x / rad, -angles.y / rad, angles.z / rad]),
    position: rounded([-position.x, position.y, position.z]),
    scale: rounded(scale.toArray())
  };
  return result;
}
