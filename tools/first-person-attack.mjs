// Keep the verified Simple-Trail example attack keyframes unchanged.
export function firstPersonSwordAttack(items, animationBytes) {
  const isSword = `query.is_item_name_any('slot.weapon.mainhand',${items.map(item => `'${item}'`).join(',')})`;
  const controller = {
    format_version: '1.10.0',
    animation_controllers: {
      'controller.animation.player.first_person_attack': {
        initial_state: 'default',
        states: {
          default: {
            animations: [
              {first_person_attack_rotation: `!${isSword}`},
              {first_person_attack_rotation_item: isSword}
            ],
            transitions: [{vr_attack: 'variable.is_using_vr'}]
          },
          vr_attack: {
            animations: ['first_person_vr_attack_rotation'],
            transitions: [{default: '!variable.is_using_vr'}]
          }
        }
      }
    }
  };
  const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return new Map([
    ['subpacks/default/animation_controllers/sword_attack.animation_controllers.json', encode(controller)],
    ['subpacks/default/animations/sword_attack.animation.json', animationBytes]
  ]);
}
