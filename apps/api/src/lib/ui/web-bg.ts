// The brand silver-web background: gradient defs + two parallax web layers
// (far at 300,260 / near at 1140,520) + the cursor spotlight overlay.
// Shared by the landing page and the portal auth pages; each page supplies
// its own opacity/animation CSS for .web-bg-far/.web-bg-near/.spotlight.

function webShape(cls: string, cx: number, cy: number): string {
  return `
  <svg class="${cls}" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g transform="translate(${cx},${cy})">
      <line class="thread" x1="0" y1="0" x2="0" y2="-700"/><line class="thread" x1="0" y1="0" x2="495" y2="-495"/>
      <line class="thread" x1="0" y1="0" x2="700" y2="0"/><line class="thread" x1="0" y1="0" x2="495" y2="495"/>
      <line class="thread" x1="0" y1="0" x2="0" y2="700"/><line class="thread" x1="0" y1="0" x2="-495" y2="495"/>
      <line class="thread" x1="0" y1="0" x2="-700" y2="0"/><line class="thread" x1="0" y1="0" x2="-495" y2="-495"/>
      <polygon class="thread" points="0,-80 57,-57 80,0 57,57 0,80 -57,57 -80,0 -57,-57"/>
      <polygon class="thread" points="0,-180 127,-127 180,0 127,127 0,180 -127,127 -180,0 -127,-127"/>
      <polygon class="thread" points="0,-300 212,-212 300,0 212,212 0,300 -212,212 -300,0 -212,-212"/>
      <polygon class="thread" points="0,-440 311,-311 440,0 311,311 0,440 -311,311 -440,0 -311,-311"/>
      <polygon class="thread" points="0,-580 410,-410 580,0 410,410 0,580 -410,410 -580,0 -410,-410"/>
      <polygon class="thread" points="0,-680 481,-481 680,0 481,481 0,680 -481,481 -680,0 -481,-481"/>
    </g>
  </svg>`;
}

export const WEB_BG_HTML = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <linearGradient id="silver-far" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7a7a82"/><stop offset=".5" stop-color="#c0c0c0"/><stop offset="1" stop-color="#5a5a62"/>
      </linearGradient>
      <linearGradient id="silver-near" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#c0c0c0"/><stop offset=".5" stop-color="#e8e8e8"/><stop offset="1" stop-color="#9a9aa2"/>
      </linearGradient>
    </defs>
  </svg>
  ${webShape("web-bg-far", 300, 260)}
  ${webShape("web-bg-near", 1140, 520)}
  <div class="spotlight"></div>
`;
