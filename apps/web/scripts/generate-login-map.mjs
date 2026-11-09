/* global console, process */
// Genera apps/web/public/login-map.svg: ciudad isométrica con ruta, paradas y un pin destacado.
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const W = 1200, H = 1400;
const UNIT = 26;
const ORIGIN = { x: W / 2, y: H * 0.5 };
const ZS = 22;

// Proyección isométrica 2:1; (0, 0) queda en el centro de la imagen.
const iso = (x, y, z = 0) => [ORIGIN.x + (x - y) * UNIT, ORIGIN.y + (x + y) * (UNIT / 2) - z * ZS];
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const poly = (list, fill, extra = '') => `<polygon points="${pts(list)}" fill="${fill}"${extra}/>`;

// Generador con semilla: la imagen sale igual en cada ejecución.
let seed = 20261106;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

const PERIOD = 8, BLOCK = 6, RANGE = 7;
const COLORS = {
  road: '#f4f8f5', sidewalk: '#e4efe8', park: '#bfe6cf', parkEdge: '#a6d9bc', sea: '#b9dff3', seaDeep: '#a4d3ec', sand: '#f3ead6',
  top: '#ffffff', left: '#d9e8e0', right: '#bdd6ca',
  accentTop: '#22b573', accentLeft: '#0e8150', accentRight: '#0c6b43',
  route: '#0c7a4b', pin: '#ea580c', pinDark: '#c2410c',
};

const ground = [], buildings = [];
const COAST = -14;
const isCoast = (x, y) => x - y < COAST;

// La ruta sube en escalera desde abajo a la izquierda hasta el pin, en el centro del encuadre.
const routePath = [[15, 23], [15, 15], [7, 15], [7, 7], [-1, 7], [-1, -9]];
const nearRoute = (x, y) => routePath.slice(1).some(([bx, by], index) => {
  const [ax, ay] = routePath[index];
  const minX = Math.min(ax, bx) - 3, maxX = Math.max(ax, bx) + 3;
  const minY = Math.min(ay, by) - 3, maxY = Math.max(ay, by) + 3;
  return x + BLOCK > minX && x < maxX && y + BLOCK > minY && y < maxY;
});

function box(x, y, sx, sy, h, accent) {
  const c = accent
    ? [COLORS.accentTop, COLORS.accentLeft, COLORS.accentRight]
    : [COLORS.top, COLORS.left, COLORS.right];
  return {
    depth: x + y + sx + sy,
    svg: poly([iso(x, y + sy, 0), iso(x + sx, y + sy, 0), iso(x + sx, y + sy, h), iso(x, y + sy, h)], c[1])
      + poly([iso(x + sx, y, 0), iso(x + sx, y + sy, 0), iso(x + sx, y + sy, h), iso(x + sx, y, h)], c[2])
      + poly([iso(x, y, h), iso(x + sx, y, h), iso(x + sx, y + sy, h), iso(x, y + sy, h)], c[0]),
  };
}

function tree(x, y) {
  const [cx, cy] = iso(x, y, 0);
  return {
    depth: x + y,
    svg: `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="9" ry="4.5" fill="#8fcfa9"/>`
      + `<circle cx="${cx.toFixed(1)}" cy="${(cy - 13).toFixed(1)}" r="11" fill="#2fa56e"/>`
      + `<circle cx="${(cx - 3).toFixed(1)}" cy="${(cy - 16).toFixed(1)}" r="5" fill="#57c08c"/>`,
  };
}

for (let i = -RANGE; i <= RANGE; i += 1) {
  for (let j = -RANGE; j <= RANGE; j += 1) {
    const x = i * PERIOD, y = j * PERIOD;
    if (isCoast(x, y)) continue;
    const park = (Math.abs(i + 2) + Math.abs(j - 2) <= 1) || (i === 2 && j === -3) || rnd() < 0.05;
    const corners = [iso(x, y), iso(x + BLOCK, y), iso(x + BLOCK, y + BLOCK), iso(x, y + BLOCK)];
    ground.push(poly(corners, park ? COLORS.park : COLORS.sidewalk));
    if (park) {
      for (let t = 0; t < 7; t += 1) buildings.push(tree(x + 0.8 + rnd() * (BLOCK - 1.6), y + 0.8 + rnd() * (BLOCK - 1.6)));
      continue;
    }
    // Cuatro lotes por manzana, cada uno con un edificio de altura variable.
    const near = nearRoute(x, y);
    for (const [lx, ly] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
      if (rnd() < 0.15) continue;
      const h = near ? 0.5 + rnd() * 0.7 : 1 + rnd() * rnd() * 6;
      buildings.push(box(x + lx + 0.35, y + ly + 0.35, 2.3, 2.3, h, !near && rnd() < 0.07));
    }
  }
}

const stops = routePath.slice(0, -1).filter((_, index) => index % 2 === 0);
const destination = routePath[routePath.length - 1];
const routePoints = pts(routePath.map(([x, y]) => iso(x, y)));

const route = `<polyline points="${routePoints}" fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<polyline points="${routePoints}" fill="none" stroke="${COLORS.route}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;

const stopMarks = stops.map(([x, y]) => {
  const [cx, cy] = iso(x, y);
  return `<ellipse cx="${cx}" cy="${cy}" rx="26" ry="13" fill="#ffffff"/><ellipse cx="${cx}" cy="${cy}" rx="15" ry="7.5" fill="${COLORS.route}"/>`;
}).join('');

// Camión sobre el tramo central de la ruta: caja verde y cabina blanca.
const [vx, vy] = [0.6, 6.4];
const van = [box(vx, vy, 1.2, 1.2, 0.8, false), box(vx + 1.2, vy, 3.2, 1.2, 1.2, true)].map((item) => item.svg).join('');

// Pin grande con volumen: gota con degradado, disco blanco y sombra en el suelo.
const [px, py] = iso(...destination);
const pinTop = py - 150;
const pin = `
  <ellipse cx="${px}" cy="${py}" rx="74" ry="37" fill="${COLORS.pin}" fill-opacity="0.14"/>
  <ellipse cx="${px}" cy="${py}" rx="46" ry="23" fill="${COLORS.pin}" fill-opacity="0.26"/>
  <ellipse cx="${px}" cy="${py}" rx="16" ry="8" fill="#7c2d12" fill-opacity="0.55"/>
  <path d="M${px} ${py} C${px - 12} ${py - 40} ${px - 66} ${pinTop + 62} ${px - 66} ${pinTop} A66 66 0 1 1 ${px + 66} ${pinTop} C${px + 66} ${pinTop + 62} ${px + 12} ${py - 40} ${px} ${py} Z" fill="url(#pin)"/>
  <path d="M${px} ${py} C${px + 12} ${py - 40} ${px + 66} ${pinTop + 62} ${px + 66} ${pinTop} A66 66 0 0 0 ${px + 20} ${pinTop - 63} C${px + 40} ${pinTop - 20} ${px + 34} ${pinTop + 50} ${px} ${py} Z" fill="${COLORS.pinDark}" fill-opacity="0.55"/>
  <ellipse cx="${px - 24}" cy="${pinTop - 34}" rx="17" ry="10" fill="#ffffff" fill-opacity="0.35" transform="rotate(-35 ${px - 24} ${pinTop - 34})"/>
  <circle cx="${px}" cy="${pinTop}" r="28" fill="#ffffff"/>
  <circle cx="${px}" cy="${pinTop}" r="13" fill="${COLORS.pinDark}"/>`;

const sorted = buildings.sort((a, b) => a.depth - b.depth).map((item) => item.svg).join('');

// Mar y playa a la izquierda, como la costa de Lima.
const coastLine = (offset) => [iso(-120 + COAST + offset, -120), iso(120 + COAST + offset, 120)];
const sea = poly([iso(-260, -120), ...coastLine(-1), iso(-260, 120)], COLORS.sea);
const sand = poly([...coastLine(-1), ...coastLine(1.5).reverse()], COLORS.sand);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="pin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fb923c"/><stop offset="1" stop-color="${COLORS.pin}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="${COLORS.road}"/>
${sea}${sand}
${ground.join('')}
${sorted}
${route}${stopMarks}${van}
${pin}
</svg>
`;

writeFileSync(OUT, svg);
console.log(`${(svg.length / 1024).toFixed(1)} KB`);
