'use strict';
/* La ménagerie : illustrations (SVG) des animaux de la maison.
   animal('noir' | 'roux' | 'blanc' | 'angora' | 'cheval', largeur_px) -> <svg …> */

let animalUid = 0;
const mirrorX = (d, w = 200) => d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(w - x).toFixed(1)} ${y}`);

/* ------------------------------------------------------------------ chats
   Chat assis de face, viewBox 200×200. Toutes les formes de gauche sont recopiées en miroir. */
const CAT = {
  tail: 'M138 174 C166 178 184 160 181 134 C179 118 170 106 158 101 C152 99 148 104 153 109 C163 119 168 133 165 147 C162 160 151 166 136 163 Z',
  plume: 'M134 177 C172 184 196 160 191 126 C188 104 172 90 156 89 C146 89 143 98 150 104 C164 115 171 130 169 145 C167 160 153 168 130 165 Z',
  body: 'M100 92 C73 92 57 117 55 146 C53 169 68 183 100 183 C132 183 147 169 145 146 C143 117 127 92 100 92 Z',
  haunch: 'M57 146 C47 163 54 182 77 182 C89 182 93 173 88 162 C83 150 69 141 57 146 Z',
  leg: 'M78 126 C75 147 75 166 77 177 L95 177 C97 166 97 146 95 126 Z',
  paw: 'M73 177 C73 170 80 167 86 167 C92 167 99 170 99 177 C99 183 93 185 86 185 C79 185 73 183 73 177 Z',
  chest: 'M100 102 C87 102 80 117 83 134 C89 129 95 129 100 136 C105 129 111 129 117 134 C120 117 113 102 100 102 Z',
  head: 'M100 30 C70 30 46 46 44 72 C42 91 57 105 76 109 C86 111 93 112 100 112 C107 112 114 111 124 109 C143 105 158 91 156 72 C154 46 130 30 100 30 Z',
  ear: 'M50 62 C45 43 48 24 57 11 C68 17 81 29 88 38 Z',
  earIn: 'M57 53 C54 40 56 29 60 21 C67 27 75 34 80 41 Z',
  muzzle: 'M100 87 C92 84 82 88 82 96 C82 103 90 106 97 103 C99 102 100 101 100 100 C100 101 101 102 103 103 C110 106 118 103 118 96 C118 88 108 84 100 87 Z',
  cheekTuft: 'M48 66 C42 70 38 74 36 79 C40 79 43 79 46 80 C41 84 38 88 37 93 C41 91 45 90 48 90 C45 94 44 98 45 102 C49 99 53 98 57 98 C57 101 58 104 61 106 L66 98 Z',
  ruff: 'M70 104 C66 109 64 113 63 118 C67 116 71 115 75 115 C73 119 72 123 73 128 C77 124 81 121 85 120 C86 124 88 128 92 131 C95 127 97 124 100 121 C103 124 105 127 108 131 C112 128 114 124 115 120 C119 121 123 124 127 128 C128 123 127 119 125 115 C129 115 133 116 137 118 C136 113 134 109 130 104 Z',
  bodyTuft: 'M60 124 C55 127 51 131 49 136 C52 136 55 137 57 138 C53 142 50 146 49 151 C52 150 55 150 58 151 C55 155 54 159 54 163 L63 150 Z',
};

function cat(o) {
  const id = `a${++animalUid}`;
  const L = o.line;
  const st = (w = 2.2) => `stroke="${L}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const both = (d, attrs) => `<path d="${d}" ${attrs}/><path d="${mirrorX(d)}" ${attrs}/>`;
  const fur = (d, w = 1.5, color = o.shade, op = 0.7) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  const long = o.coat === 'long', medium = o.coat === 'medium';
  const tailD = long || medium ? CAT.plume : CAT.tail;

  const defs = `<defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.light}"/><stop offset=".55" stop-color="${o.base}"/><stop offset="1" stop-color="${o.shade}"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.light}"/><stop offset=".7" stop-color="${o.base}"/><stop offset="1" stop-color="${o.base}"/></linearGradient>
    <radialGradient id="${id}e" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="${o.eyeLight}"/><stop offset=".75" stop-color="${o.eye}"/><stop offset="1" stop-color="${o.eyeRim}"/></radialGradient>
    <linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.inner}"/><stop offset="1" stop-color="${o.innerDeep}"/></linearGradient>
    <clipPath id="${id}ct"><path d="${tailD}"/></clipPath>
    <clipPath id="${id}cb"><path d="${CAT.body}"/></clipPath>
    <clipPath id="${id}ch"><path d="${CAT.head}"/></clipPath>
  </defs>`;

  // --- queue (derrière), avec anneaux éventuels
  let tail = `<path d="${tailD}" fill="url(#${id}b)" ${st()}/>`;
  if (o.tailRings) {
    tail += `<g clip-path="url(#${id}ct)" stroke="${o.stripe}" stroke-width="${long ? 7 : 6}" stroke-linecap="round" fill="none">
      <path d="M150 166 L160 182"/><path d="M164 160 L182 170"/><path d="M168 146 L192 148"/><path d="M166 131 L190 126"/><path d="M160 117 L182 106"/></g>`;
  }
  if (long || medium) tail += [0, 1, 2, 3, 4].map((i) => fur(`M${172 + i * 3} ${108 + i * 14} q${8 - i} ${4} ${10 - i * 2} ${10}`, 1.4, o.shade, 0.6)).join('');

  // --- corps
  let body = `<path d="${CAT.body}" fill="url(#${id}b)" ${st()}/>`;
  if (long || medium) body += both(CAT.bodyTuft, `fill="${o.base}" ${st(1.8)}`);
  body += `<g clip-path="url(#${id}cb)">${both(CAT.haunch, `fill="${o.shade}" opacity=".35"`)}${both('M60 150 C70 146 82 152 87 163', `fill="none" ${st(1.6)} opacity=".7"`)}</g>`;
  if (o.bodyStripes) {
    body += `<g clip-path="url(#${id}cb)" fill="none" stroke="${o.stripe}" stroke-width="4" stroke-linecap="round">
      ${both('M56 120 C64 122 70 128 72 136', '')}${both('M54 138 C62 140 68 146 70 154', '')}${both('M58 156 C64 158 68 164 70 170', '')}</g>`;
  }
  body += `<path d="${CAT.chest}" fill="${o.chest || o.light}" opacity="${o.chest ? 1 : 0.55}"/>`;
  body += fur('M90 114 Q95 119 100 114 Q105 119 110 114 M93 122 Q97 126 100 122 Q103 126 107 122', 1.4, o.shade, 0.5);
  body += both(CAT.leg, `fill="${o.base}"`) + both('M77 150 C76 162 76 170 77 177 M95 150 C96 162 96 170 95 177', `fill="none" ${st(1.8)}`);
  body += both('M80 134 C79 142 79 148 80 152 M92 134 C93 142 93 148 92 152', `fill="none" stroke="${o.shade}" stroke-width="1.5" stroke-linecap="round" opacity=".6"`);
  if (o.legStripes) body += both('M78 140 L94 142 M77 152 L95 154', `fill="none" stroke="${o.stripe}" stroke-width="3.2" stroke-linecap="round"`);
  body += both(CAT.paw, `fill="${o.paws}" ${st()}`) + both('M82 177 L82 183 M90 177 L90 183', `fill="none" ${st(1.4)}`);

  // --- tête
  let head = '';
  if (long || medium) head += both(CAT.cheekTuft, `fill="${o.base}" ${st(1.8)}`);
  if (long) head += `<path d="${CAT.ruff}" fill="${o.chest || o.light}" ${st(1.8)}/>`;
  head += both(CAT.ear, `fill="${o.base}" ${st()}`) + both(CAT.earIn, `fill="url(#${id}i)"`);
  if (long || medium) head += both('M62 46 L70 36 M66 50 L76 41 M60 40 L66 29', `fill="none" stroke="${o.earTuft}" stroke-width="1.8" stroke-linecap="round"`);
  head += `<path d="${CAT.head}" fill="url(#${id}h)" ${st()}/>`;
  if (o.headStripes) {
    head += `<g clip-path="url(#${id}ch)" fill="none" stroke="${o.stripe}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${o.headStripes}</g>`;
  }
  head += fur('M84 38 q3 -4 6 0 M110 38 q3 -4 6 0', 1.4, o.shade, 0.5);
  if (o.muzzleColor) head += `<path d="${CAT.muzzle}" fill="${o.muzzleColor}"/>`;
  head += both('M58 89 C61 85 70 85 73 89 C70 93 61 93 58 89 Z', `fill="#f59ab2" opacity="${o.blush}"`);

  // yeux
  const eye = (cx) => `<circle cx="${cx}" cy="72" r="11.5" fill="url(#${id}e)" ${st(1.8)}/>
    ${o.slit ? `<ellipse cx="${cx}" cy="72.5" rx="3.2" ry="8.6" fill="#141114"/>` : `<circle cx="${cx}" cy="73" r="6.6" fill="#141114"/>`}
    <circle cx="${cx - 3.8}" cy="68" r="3.4" fill="#fff"/><circle cx="${cx + 4}" cy="77" r="1.6" fill="#fff" opacity=".9"/>
    <path d="M${cx - 13} 69 C${cx - 9} 58 ${cx + 9} 58 ${cx + 13} 69" fill="none" stroke="${L}" stroke-width="3" stroke-linecap="round"/>`;
  head += eye(78) + eye(122);
  head += both('M65.5 64 L60 61', `fill="none" stroke="${L}" stroke-width="1.8" stroke-linecap="round"`);
  // nez et bouche
  head += `<path d="M93.5 86 C93.5 82.5 106.5 82.5 106.5 86 C106.5 89 102.5 92.5 100 93.5 C97.5 92.5 93.5 89 93.5 86 Z" fill="${o.nose}" ${st(1.4)}/>
    <ellipse cx="97.6" cy="85.3" rx="2" ry="1.1" fill="#fff" opacity=".6"/>
    <path d="M100 93.5 L100 97 C98.5 101.5 92.5 101.5 90.5 98 M100 97 C101.5 101.5 107.5 101.5 109.5 98" fill="none" stroke="${L}" stroke-width="1.8" stroke-linecap="round"/>`;
  head += both('M84 96 C70 92 56 92 42 94 M84 99 C70 99 58 101 46 104 M85 102 C74 104 64 108 54 114', `fill="none" stroke="${o.whiskers}" stroke-width="1.2" stroke-linecap="round" opacity=".75"`);
  head += both('M86 93 L86.1 93 M89 96 L89.1 96 M86 98 L86.1 98', `stroke="${o.shade}" stroke-width="2.2" stroke-linecap="round" opacity=".7"`);

  return `${defs}<ellipse cx="100" cy="188" rx="64" ry="7" fill="#3d2f35" opacity=".12"/>${tail}${body}${head}`;
}

/* ------------------------------------------------------------------ cheval
   De profil (tête à gauche), viewBox 240×200. Robe crème, taches brun clair. */
function horse() {
  const id = `a${++animalUid}`;
  const L = '#5a4237', cream = '#fbf3e4', creamShade = '#ead9bd', spot = '#d6ad7f', mane = '#c3946a', maneDark = '#a57a54', hoof = '#8d6e5c', muzzle = '#efd3c3';
  const st = (w = 2.2) => `stroke="${L}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const body = 'M74 104 C72 86 90 76 118 76 C146 76 172 74 190 84 C205 92 207 116 199 130 C192 141 172 144 150 141 C126 138 100 141 86 135 C76 130 75 116 74 104 Z';
  // Encolure : de la mâchoire au poitrail (devant) et de la nuque au garrot (dessus), raccordée au corps.
  const throat = 'M60 66 C64 80 70 94 74 108';
  const crest = 'M84 40 C98 52 108 64 118 78';
  const neck = `${throat} L100 112 L118 78 C108 64 98 52 84 40 Z`;
  const head = 'M86 38 C82 26 70 20 58 24 C46 28 33 42 25 57 C21 65 23 75 32 77 C41 79 50 74 58 68 C67 61 76 54 83 48 C88 44 89 41 86 38 Z';
  // trèfle à quatre feuilles (sans tige) à l'épaule : quatre ronds écartés du centre (échancrures
  // profondes entre les feuilles), reliés par un petit rond central
  const spots = `<circle cx="132" cy="85.5" r="6.4"/><circle cx="140.5" cy="94" r="6.4"/><circle cx="132" cy="102.5" r="6.4"/><circle cx="123.5" cy="94" r="6.4"/><circle cx="132" cy="94" r="4.5"/>
    <path d="M170 92 C180 88 194 96 192 110 C190 122 176 124 170 116 C164 108 162 96 170 92 Z"/>
    <path d="M136 116 C142 112 152 116 150 124 C148 130 138 130 135 125 Z"/>`;
  // jambe : haut large, genou, canon fin, boulet arrondi
  const leg = (x, top, shade) => `<path d="M${x - 1} ${top} C${x - 1} ${top + 14} ${x + 1} 144 ${x + 2} 152 C${x + 3} 158 ${x + 2} 164 ${x + 1} 168 C${x - 1} 171 ${x} 175 ${x + 1} 176 L${x + 15} 176 C${x + 16} 172 ${x + 15} 169 ${x + 13} 166 C${x + 12} 160 ${x + 12} 156 ${x + 13} 150 C${x + 15} 142 ${x + 17} ${top + 14} ${x + 17} ${top} Z" fill="${shade}" ${st()}/>
    <path d="M${x - 1} 174 L${x + 16} 174 L${x + 18} 184 C${x + 12} 186 ${x + 3} 186 ${x - 3} 184 Z" fill="${hoof}" ${st()}/>
    <path d="M${x + 2} 162 C${x + 6} 166 ${x + 11} 166 ${x + 14} 162" fill="none" stroke="${creamShade}" stroke-width="2" stroke-linecap="round"/>`;
  return `<defs>
      <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="150"><stop offset="0" stop-color="#fffaf1"/><stop offset=".6" stop-color="${cream}"/><stop offset="1" stop-color="${creamShade}"/></linearGradient>
      <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mane}"/><stop offset="1" stop-color="${maneDark}"/></linearGradient>
      <clipPath id="${id}cb"><path d="${body}"/></clipPath><clipPath id="${id}cn"><path d="${neck}"/></clipPath>
    </defs>
    <ellipse cx="132" cy="188" rx="92" ry="7" fill="#3d2f35" opacity=".12"/>
    <!-- queue -->
    <path d="M197 92 C216 96 226 122 220 150 C217 166 209 178 199 184 C203 168 204 152 200 136 C198 124 192 112 188 104 Z" fill="url(#${id}m)" ${st()}/>
    <path d="M204 104 C212 120 214 140 208 162 M198 112 C204 128 204 146 200 166" fill="none" stroke="${maneDark}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
    <!-- jambes du fond -->
    ${leg(98, 124, creamShade)}${leg(168, 126, creamShade)}
    <!-- jambes du côté visible : sous le corps, qui recouvre leur haut -->
    ${leg(80, 120, cream)}${leg(180, 120, cream)}
    <path d="M181 152 C186 156 192 156 195 152" fill="${spot}" opacity=".9"/>
    <!-- corps, puis encolure par-dessus (sans contour en bas : pas de couture visible) -->
    <path d="${body}" fill="url(#${id}b)" ${st()}/>
    <g clip-path="url(#${id}cb)" fill="${spot}">${spots}</g>
    <path d="${neck}" fill="url(#${id}b)"/>
    <path d="${throat}" fill="none" ${st()}/><path d="${crest}" fill="none" ${st()}/>
    <g clip-path="url(#${id}cn)" fill="${spot}"><path d="M84 58 C90 54 96 62 94 70 C92 78 84 78 82 70 C81 64 80 61 84 58 Z"/></g>
    <path d="M150 136 C164 134 180 132 192 124" fill="none" stroke="${creamShade}" stroke-width="3" stroke-linecap="round"/>
    <path d="M176 92 C186 100 190 112 186 124" fill="none" stroke="${L}" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>
    <!-- crinière -->
    <path d="M84 30 C96 30 104 40 108 52 C112 64 114 74 117 84 C110 82 106 78 103 72 C104 80 104 86 103 92 C97 86 94 78 93 70 C90 76 88 80 84 84 C84 74 86 64 88 56 C84 58 80 60 76 60 C80 52 84 44 84 30 Z" fill="url(#${id}m)" ${st()}/>
    <path d="M90 40 C96 48 100 58 104 70 M86 46 C90 54 92 62 94 70" fill="none" stroke="${maneDark}" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
    <!-- tête -->
    <path d="${head}" fill="url(#${id}b)" ${st()}/>
    <path d="M25 57 C21 65 23 75 32 77 C41 79 47 73 45 66 C43 59 33 54 25 57 Z" fill="${muzzle}"/>
    <path d="M25 57 C21 65 23 75 32 77 C41 79 50 74 58 68" fill="none" ${st()}/>
    <path d="M29 63 C31 61 34 62 34 65" fill="none" ${st(2)}/>
    <path d="M28 72 C32 74 37 73 40 70" fill="none" ${st(1.8)}/>
    <path d="M58 68 C64 70 70 66 74 58" fill="none" stroke="${creamShade}" stroke-width="2.4" stroke-linecap="round"/>
    <!-- oreilles -->
    <path d="M70 30 C68 20 70 12 74 6 C80 12 82 22 80 32 Z" fill="${creamShade}" ${st()}/>
    <path d="M77 32 C76 21 79 13 84 8 C89 15 90 25 86 35 Z" fill="${cream}" ${st()}/>
    <path d="M80 28 C80 21 82 16 84 13 C87 18 87 24 85 30 Z" fill="#f0b9c2"/>
    <!-- toupet -->
    <path d="M76 30 C70 32 64 36 62 44 C68 40 70 42 72 46 C74 40 78 38 84 38 Z" fill="url(#${id}m)" ${st(1.8)}/>
    <!-- œil -->
    <path d="M51 44 C53 38 63 37 66 43 C63 49 54 50 51 44 Z" fill="#3a2a26" ${st(1.6)}/>
    <circle cx="56" cy="42.5" r="2" fill="#fff"/><circle cx="61" cy="45.5" r=".9" fill="#fff"/>
    <path d="M51 43 C53 36 63 35 67 42 M52 40 l-3 -3 M55 38.5 l-1.5 -3.6 M59 38 l0 -3.8" fill="none" stroke="${L}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="50" cy="56" rx="6" ry="3.4" fill="#f59ab2" opacity=".4"/>`;
}

const CATS = {
  noir: {
    base: '#2e2a33', shade: '#1d1a21', light: '#4a4452', line: '#121014', chest: null, paws: '#2e2a33',
    inner: '#9b6b84', innerDeep: '#5e3d50', eye: '#d9c943', eyeLight: '#f6ef9a', eyeRim: '#9a8a1e', slit: true,
    nose: '#7a5266', whiskers: '#e8e2ea', blush: 0.25, earTuft: '#555',
  },
  roux: {
    base: '#f0a057', shade: '#d37a32', light: '#fbc58c', line: '#7a3f1d', chest: '#fde8d2', paws: '#fde8d2',
    inner: '#f9c9be', innerDeep: '#e8998f', eye: '#b8862a', eyeLight: '#f2d27a', eyeRim: '#7a5414',
    nose: '#ef8fa4', whiskers: '#7a3f1d', blush: 0.4, muzzleColor: '#fde8d2', stripe: '#cf6f28', tailRings: true,
    bodyStripes: true, legStripes: true,
    headStripes: 'M88 34 L90 46 M100 31 L100 46 M112 34 L110 46 M46 72 L58 74 M46 80 L57 80 M154 72 L142 74 M154 80 L143 80',
  },
  blanc: {
    base: '#fffdf8', shade: '#e6dcd6', light: '#ffffff', line: '#8b7a80', chest: '#ffffff', paws: '#fffdf8', coat: 'medium',
    inner: '#f8cdd6', innerDeep: '#eaa3b3', eye: '#5b93c9', eyeLight: '#a9d4f3', eyeRim: '#2f5f8c',
    nose: '#f3a1b5', whiskers: '#b9aab0', blush: 0.45, earTuft: '#ffffff',
  },
  angora: {
    base: '#a6a5ad', shade: '#7f7e87', light: '#cfced5', line: '#3e3d44', chest: '#e2e1e6', paws: '#c8c7ce', coat: 'long',
    inner: '#e0c3cb', innerDeep: '#bf98a4', eye: '#8aa645', eyeLight: '#cfe08a', eyeRim: '#56701e',
    nose: '#c98b9b', whiskers: '#f2f1f4', blush: 0.35, earTuft: '#efeef2', stripe: '#3b3a42', tailRings: true,
    bodyStripes: true, legStripes: true,
    headStripes: 'M84 46 L88 34 L94 44 L100 30 L106 44 L112 34 L116 46 M100 50 L100 58 M46 70 L60 73 M45 78 L58 79 M47 86 L58 86 M154 70 L140 73 M155 78 L142 79 M153 86 L142 86',
  },
};

const ANIMALS = {
  noir: { label: 'le chat noir', view: '0 0 200 200', draw: () => cat(CATS.noir) },
  roux: { label: 'le chat roux', view: '0 0 200 200', draw: () => cat(CATS.roux) },
  blanc: { label: 'le chat blanc', view: '0 0 200 200', draw: () => cat(CATS.blanc) },
  angora: { label: 'le chat gris angora', view: '0 0 200 200', draw: () => cat(CATS.angora) },
  cheval: { label: 'le cheval', view: '0 0 240 200', draw: horse },
};

function animal(name, size = 64, cls = '') {
  const a = ANIMALS[name];
  const [, , w, h] = a.view.split(' ').map(Number);
  return `<svg class="animal ${cls}" viewBox="${a.view}" width="${size}" height="${Math.round(size * h / w)}" role="img" aria-label="${a.label}">${a.draw()}</svg>`;
}
const ANIMAL_NAMES = ['noir', 'roux', 'blanc', 'angora', 'cheval'];
