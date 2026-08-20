// 武器数据表 —— 服务器端唯一权威来源，welcome 时下发客户端
const CATEGORIES = [
  { id: "rifle",   name: "步枪",   desc: "全距离均衡" },
  { id: "smg",     name: "冲锋枪", desc: "近距高速" },
  { id: "sniper",  name: "狙击枪", desc: "远程制敌" },
  { id: "shotgun", name: "霰弹枪", desc: "近距爆发" },
  { id: "pistol",  name: "手枪",   desc: "轻便灵活" },
  { id: "lmg",     name: "机枪",   desc: "持续压制" },
  { id: "melee",   name: "近战",   desc: "贴身肉搏" },
];

// 字段: damage, fireInterval, magSize, reloadTime, recoil, spread, range, scope, moveSpeed
const WEAPONS = [
  // 步枪
  { id: "ak47",  name: "AK-47",  category: "rifle",  damage: 34, fireInterval: 0.105, magSize: 30, reloadTime: 2.6, recoil: 0.016, spread: 0.011, range: 220, scope: 1.0,  moveSpeed: 0.94 },
  { id: "m4a1",  name: "M4A1",   category: "rifle",  damage: 30, fireInterval: 0.090, magSize: 30, reloadTime: 2.2, recoil: 0.011, spread: 0.008, range: 210, scope: 1.0,  moveSpeed: 0.97 },
  { id: "aug",   name: "AUG",    category: "rifle",  damage: 29, fireInterval: 0.090, magSize: 30, reloadTime: 2.3, recoil: 0.009, spread: 0.006, range: 230, scope: 1.35, moveSpeed: 0.95 },
  // 冲锋枪
  { id: "mp5",   name: "MP5",    category: "smg",    damage: 26, fireInterval: 0.075, magSize: 30, reloadTime: 2.0, recoil: 0.008, spread: 0.014, range: 130, scope: 1.0,  moveSpeed: 1.02 },
  { id: "ump45", name: "UMP45",  category: "smg",    damage: 30, fireInterval: 0.090, magSize: 25, reloadTime: 2.1, recoil: 0.009, spread: 0.012, range: 140, scope: 1.0,  moveSpeed: 1.00 },
  { id: "p90",   name: "P90",    category: "smg",    damage: 24, fireInterval: 0.060, magSize: 50, reloadTime: 2.4, recoil: 0.007, spread: 0.013, range: 120, scope: 1.0,  moveSpeed: 1.03 },
  // 狙击枪
  { id: "awm",    name: "AWM",    category: "sniper", damage: 115, fireInterval: 1.40, magSize: 5,  reloadTime: 3.2, recoil: 0.050, spread: 0.001, range: 400, scope: 4.0, moveSpeed: 0.88 },
  { id: "barrett",name: "巴雷特", category: "sniper", damage: 130, fireInterval: 1.60, magSize: 10, reloadTime: 3.6, recoil: 0.060, spread: 0.001, range: 450, scope: 4.0, moveSpeed: 0.85 },
  { id: "kar98k", name: "Kar98k", category: "sniper", damage: 90,  fireInterval: 1.10, magSize: 5,  reloadTime: 2.8, recoil: 0.045, spread: 0.001, range: 350, scope: 3.0, moveSpeed: 0.92 },
  // 霰弹枪
  { id: "m870",  name: "M870",   category: "shotgun", damage: 13, fireInterval: 0.90, magSize: 6, reloadTime: 3.0, recoil: 0.040, spread: 0.060, range: 40, scope: 1.0, moveSpeed: 0.95, pellets: 8 },
  { id: "spas12",name: "SPAS-12",category: "shotgun", damage: 12, fireInterval: 0.70, magSize: 8, reloadTime: 3.2, recoil: 0.045, spread: 0.055, range: 45, scope: 1.0, moveSpeed: 0.93, pellets: 9 },
  // 手枪
  { id: "deagle", name: "沙漠之鹰", category: "pistol", damage: 50, fireInterval: 0.40, magSize: 7,  reloadTime: 2.0, recoil: 0.035, spread: 0.008, range: 150, scope: 1.0, moveSpeed: 1.05 },
  { id: "glock",  name: "格洛克",  category: "pistol", damage: 22, fireInterval: 0.08, magSize: 20, reloadTime: 1.8, recoil: 0.010, spread: 0.015, range: 100, scope: 1.0, moveSpeed: 1.08 },
  { id: "usp",    name: "USP",     category: "pistol", damage: 30, fireInterval: 0.15, magSize: 12, reloadTime: 1.9, recoil: 0.012, spread: 0.009, range: 120, scope: 1.0, moveSpeed: 1.06 },
  // 机枪
  { id: "m249", name: "M249", category: "lmg", damage: 28, fireInterval: 0.075, magSize: 100, reloadTime: 4.5, recoil: 0.014, spread: 0.016, range: 200, scope: 1.0, moveSpeed: 0.88 },
  { id: "rpk",  name: "RPK",  category: "lmg", damage: 32, fireInterval: 0.090, magSize: 75,  reloadTime: 4.0, recoil: 0.016, spread: 0.014, range: 210, scope: 1.0, moveSpeed: 0.90 },
  // 近战
  { id: "knife",  name: "军刀",   category: "melee", damage: 60, fireInterval: 0.45, magSize: Infinity, reloadTime: 0, recoil: 0, spread: 0, range: 2.5, scope: 1.0, moveSpeed: 1.15, melee: true },
  { id: "katana", name: "武士刀", category: "melee", damage: 90, fireInterval: 0.70, magSize: Infinity, reloadTime: 0, recoil: 0, spread: 0, range: 3.0, scope: 1.0, moveSpeed: 1.10, melee: true },
];

const MODES = [
  { id: "tdm",  name: "团队竞技", desc: "红蓝两队对抗，先达目标击杀数的队伍获胜" },
  { id: "dm",   name: "个人竞技", desc: "各自为战，先达目标击杀数的玩家获胜" },
  { id: "bomb", name: "爆破模式", desc: "进攻方安放炸弹，防守方阻止或拆除" },
];

function getWeapon(id) { return WEAPONS.find(w => w.id === id) || WEAPONS[0]; }
function getCategory(id) { return CATEGORIES.find(c => c.id === id) || CATEGORIES[0]; }

module.exports = { CATEGORIES, WEAPONS, MODES, getWeapon, getCategory };
