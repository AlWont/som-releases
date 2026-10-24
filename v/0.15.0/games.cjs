// «Играет в …»: Som смотрит, какие программы запущены, и узнаёт игры по имени файла.
// Всё происходит на этом ПК; друзьям уходит только название игры внутри зашифрованного статуса.
// Список программ отдаёт ядро прямыми вызовами Windows — никаких tasklist и PowerShell:
// их запуск раз в 20 секунд давал заметные просадки FPS в игре.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Имя exe (строчными) → название игры.
const KNOWN = {
  'cs2.exe': 'Counter-Strike 2', 'dota2.exe': 'Dota 2', 'valorant-win64-shipping.exe': 'VALORANT',
  'r5apex.exe': 'Apex Legends', 'r5apex_dx12.exe': 'Apex Legends', 'fortniteclient-win64-shipping.exe': 'Fortnite',
  'league of legends.exe': 'League of Legends', 'gta5.exe': 'GTA V', 'gta5_enhanced.exe': 'GTA V', 'rdr2.exe': 'Red Dead Redemption 2',
  'rocketleague.exe': 'Rocket League', 'overwatch.exe': 'Overwatch 2', 'rustclient.exe': 'Rust', 'eldenring.exe': 'Elden Ring',
  'nightreign.exe': 'Elden Ring Nightreign', 'cyberpunk2077.exe': 'Cyberpunk 2077', 'bg3.exe': "Baldur's Gate 3", 'bg3_dx11.exe': "Baldur's Gate 3",
  'helldivers2.exe': 'Helldivers 2', 'deadlock.exe': 'Deadlock', 'marvel-win64-shipping.exe': 'Marvel Rivals',
  'escapefromtarkov.exe': 'Escape from Tarkov', 'tslgame.exe': 'PUBG: Battlegrounds', 'warframe.x64.exe': 'Warframe',
  'genshinimpact.exe': 'Genshin Impact', 'starrail.exe': 'Honkai: Star Rail', 'palworld-win64-shipping.exe': 'Palworld',
  'lethal company.exe': 'Lethal Company', 'among us.exe': 'Among Us', 'valheim.exe': 'Valheim', 'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley', 'factorio.exe': 'Factorio', 'phasmophobia.exe': 'Phasmophobia',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight', 'tf_win64.exe': 'Team Fortress 2', 'gmod.exe': "Garry's Mod",
  'worldoftanks.exe': 'Мир танков', 'aces.exe': 'War Thunder', 'fallguys_client_game.exe': 'Fall Guys',
  'minecraft.windows.exe': 'Minecraft', 'dayz_x64.exe': 'DayZ', 'arma3_x64.exe': 'Arma 3', 'destiny2.exe': 'Destiny 2',
  'witcher3.exe': 'Ведьмак 3', 'hogwartslegacy.exe': 'Hogwarts Legacy', 'rainbowsix.exe': 'Rainbow Six Siege',
  'cod.exe': 'Call of Duty', 'bf2042.exe': 'Battlefield 2042', 'bf6.exe': 'Battlefield 6',
  'factorygame-win64-shipping.exe': 'Satisfactory', 'sonsoftheforest.exe': 'Sons of the Forest',
  'stalker2-win64-shipping.exe': 'S.T.A.L.K.E.R. 2', 'repo.exe': 'R.E.P.O.', 'peak.exe': 'PEAK',
  'osu!.exe': 'osu!', 'geometrydash.exe': 'Geometry Dash', 'hollow_knight.exe': 'Hollow Knight', 'hollow knight silksong.exe': 'Hollow Knight: Silksong',
};

const POLL_MS = 15000;

/** procs(withWindows) → { exes: [...], windows: [{ exe, title }] } из ядра или null. */
function create(configPath, onChange, procs) {
  const exeNames = async () => new Set((await procs(false).catch(() => null))?.exes || []);
  /** Программы с окнами — для ручного добавления игры и для Minecraft на Java. */
  const windows = async () => (await procs(true).catch(() => null))?.windows || [];
  let cfg = { enabled: true, custom: [], hidden: [] };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch { /* по умолчанию */ }
  let current = null; // { game, since }
  let timer = 0;
  const save = () => { try { fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(cfg)); } catch { /* не страшно */ } };

  async function detect() {
    if (process.platform !== 'win32' || !cfg.enabled) return null;
    const names = await exeNames();
    for (const c of cfg.custom) if (names.has(c.exe) && !cfg.hidden.includes(c.name)) return c.name;
    for (const [exe, name] of Object.entries(KNOWN)) if (names.has(exe) && !cfg.hidden.includes(name)) return name;
    if (names.has('javaw.exe') && !cfg.hidden.includes('Minecraft')) {
      const w = await windows();
      if (w.some((x) => x.exe === 'javaw.exe' && /^minecraft/i.test(x.title))) return 'Minecraft';
    }
    return null;
  }

  async function poll() {
    let game = null;
    try { game = await detect(); } catch { game = null; }
    if ((game || null) !== (current?.game || null)) {
      current = game ? { game, since: Date.now() } : null;
      onChange(current);
    }
  }

  return {
    resend() { if (current) onChange(current); },
    start() { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } },
    state: () => ({ ...cfg, current, platform: process.platform }),
    set(next) {
      if (typeof next.enabled === 'boolean') cfg.enabled = next.enabled;
      if (Array.isArray(next.custom)) cfg.custom = next.custom.filter((c) => c && /^[^\\/:*?"<>|]+\.exe$/i.test(c.exe) && c.name).map((c) => ({ exe: c.exe.toLowerCase(), name: String(c.name).slice(0, 60) })).slice(0, 50);
      if (Array.isArray(next.hidden)) cfg.hidden = next.hidden.map((x) => String(x).slice(0, 60)).slice(0, 100);
      save();
      poll();
      return this.state();
    },
    async running() {
      const known = new Set([...Object.keys(KNOWN), ...cfg.custom.map((c) => c.exe)]);
      const sys = /^(explorer|applicationframehost|textinputhost|systemsettings|shellexperiencehost|searchhost|startmenuexperiencehost|som|electron)\.exe$/;
      const seen = new Set();
      return (await windows()).filter((w) => !sys.test(w.exe) && !known.has(w.exe) && !seen.has(w.exe) && seen.add(w.exe));
    },
  };
}

module.exports = { create, KNOWN };
