(() => {
  'use strict';

  // ---------- 대답 ----------

  const AGAIN = '다시 한번 물어봐';

  // 질문 종류별 대답과 가중치
  const ANSWER_POOLS = {
    yesno:  [['그래', 4], ['안 돼', 4], [AGAIN, 2], ['언젠가는', 1]],
    choice: [['둘 다 안 돼', 4], ['아무것도 하지 마', 2], [AGAIN, 2]],
    what:   [['아무것도 하지 마', 4], ['가만히 있어', 2], [AGAIN, 2]],
    who:    [['아무도', 3], [AGAIN, 1]],
    where:  [['아무 데도 가지 마', 3], [AGAIN, 1]],
    when:   [['언젠가는', 3], ['지금은 안 돼', 1], [AGAIN, 1]],
    why:    [['그냥', 3], [AGAIN, 1]],
  };

  function classify(question) {
    const q = question.toLowerCase();
    if (/아니면|또는|중에|\bvs\b|\bor\b/.test(q)) return 'choice';
    if (/누구|누가|누굴/.test(q)) return 'who';
    if (/어디/.test(q)) return 'where';
    if (/언제|몇\s*시/.test(q)) return 'when';
    if (/왜/.test(q)) return 'why';
    if (/뭐|뭘|무엇|무슨|어떻게|어떡|어쩌|어떤/.test(q)) return 'what';
    return 'yesno';
  }

  function weightedPick(pool) {
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [answer, w] of pool) {
      if ((r -= w) < 0) return answer;
    }
    return pool[pool.length - 1][0];
  }

  let last = { question: null, answer: null };

  function answerFor(question) {
    let pool = ANSWER_POOLS[classify(question)];
    // 같은 질문에 "다시 한번 물어봐"가 연달아 나오지 않게
    if (last.question === question && last.answer === AGAIN) {
      pool = pool.filter(([a]) => a !== AGAIN);
    }
    const answer = weightedPick(pool);
    last = { question, answer };
    return answer;
  }

  // ---------- 소리 ----------

  let soundOn = true;
  try { soundOn = localStorage.getItem('conch-sound') !== 'off'; } catch (_) {}

  let audioCtx = null;
  let noiseBuffer = null;

  function ensureAudio() {
    if (audioCtx || !soundOn) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.03, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
  }

  // 줄이 감기는 "딸깍" 소리
  function click(when = 0, gain = 0.35) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime + when;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200 + Math.random() * 800;
    filter.Q.value = 4;
    const g = audioCtx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(audioCtx.destination);
    src.start(t);
  }

  function speak(text) {
    if (!soundOn || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    const voice = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ko'));
    if (voice) u.voice = voice;
    u.pitch = 0.4;
    u.rate = 0.8;
    speechSynthesis.speak(u);
  }

  // ---------- 소라고동 줄 ----------

  const svg = document.getElementById('conch');
  const ring = document.getElementById('ring');
  const string = document.getElementById('string');
  const bubble = document.getElementById('bubble');
  const hint = document.getElementById('hint');
  const input = document.getElementById('question');
  const form = document.getElementById('ask-form');
  const historyList = document.getElementById('history-list');
  const soundToggle = document.getElementById('sound-toggle');

  const ANCHOR = { x: 236, y: 294 };
  const REST = { x: 236, y: 330 };
  const MAX_PULL = 240;      // 줄이 늘어날 수 있는 최대 길이 (SVG 단위)
  const MIN_PULL = 90;       // 이보다 짧게 당기면 대답하지 않음
  const CLICK_STEP = 16;     // 이만큼 늘어날 때마다 딸깍

  let ringPos = { ...REST };
  let state = 'idle';        // idle | dragging | rewinding
  let grabOffset = { x: 0, y: 0 };
  let lastClickLen = 0;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const restLen = dist(ANCHOR, REST);

  function render() {
    ring.setAttribute('transform', `translate(${ringPos.x} ${ringPos.y})`);
    // 팽팽할수록 덜 처지는 줄
    const len = dist(ANCHOR, ringPos);
    const slack = Math.max(0, 1 - (len - restLen) / 120);
    const mx = (ANCHOR.x + ringPos.x) / 2;
    const my = (ANCHOR.y + ringPos.y) / 2 + 14 * slack;
    const endY = ringPos.y - 16; // 고리 윗부분에 연결
    string.setAttribute('d', `M${ANCHOR.x} ${ANCHOR.y} Q${mx + 8 * slack} ${my} ${ringPos.x} ${endY}`);
  }

  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function clampToMax(p) {
    const dx = p.x - ANCHOR.x;
    const dy = p.y - ANCHOR.y;
    const len = Math.hypot(dx, dy);
    const max = restLen + MAX_PULL;
    if (len <= max) return p;
    return { x: ANCHOR.x + dx / len * max, y: ANCHOR.y + dy / len * max };
  }

  function pullLength() {
    return Math.max(0, dist(ANCHOR, ringPos) - restLen);
  }

  ring.addEventListener('pointerdown', (e) => {
    if (state !== 'idle') return;
    e.preventDefault();
    ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    ring.setPointerCapture(e.pointerId);
    const p = toSvgPoint(e);
    grabOffset = { x: ringPos.x - p.x, y: ringPos.y - p.y };
    lastClickLen = pullLength();
    state = 'dragging';
    svg.classList.add('dragging');
    hideBubble();
  });

  ring.addEventListener('pointermove', (e) => {
    if (state !== 'dragging') return;
    const p = toSvgPoint(e);
    ringPos = clampToMax({ x: p.x + grabOffset.x, y: p.y + grabOffset.y });
    const len = pullLength();
    if (len - lastClickLen >= CLICK_STEP) {
      click(0, 0.2);
      lastClickLen = len;
    } else if (len < lastClickLen) {
      lastClickLen = len;
    }
    render();
  });

  const endDrag = () => {
    if (state !== 'dragging') return;
    svg.classList.remove('dragging');
    release();
  };
  ring.addEventListener('pointerup', endDrag);
  ring.addEventListener('pointercancel', endDrag);

  // 키보드: Enter/Space로 자동으로 당겼다 놓기
  ring.addEventListener('keydown', (e) => {
    if (state !== 'idle' || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    ensureAudio();
    autoPull();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
    ring.focus({ preventScroll: true });
  });

  function animate(duration, step) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / duration);
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function autoPull() {
    state = 'dragging';
    hideBubble();
    const from = { ...ringPos };
    const to = { x: REST.x - 60, y: REST.y + 170 };
    await animate(450, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      ringPos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      if (Math.floor(e * 10) !== Math.floor((e - 0.0001) * 10)) click(0, 0.2);
      render();
    });
    release();
  }

  async function release() {
    const len = pullLength();
    state = 'rewinding';

    if (len < MIN_PULL) {
      await rewind(250, false);
      state = 'idle';
      showNotice('조금 더 길게 당겨 봐');
      return;
    }

    const question = input.value.trim();
    svg.classList.add('shaking');
    showThinking();
    await rewind(500 + len * 7, true);
    svg.classList.remove('shaking');

    if (!question) {
      showNotice('먼저 질문을 해 줘');
      state = 'idle';
      return;
    }

    const answer = answerFor(question);
    showAnswer(answer);
    speak(answer);
    addHistory(question, answer);
    state = 'idle';
  }

  // 고리가 원래 자리로 감겨 들어가는 애니메이션
  function rewind(duration, withSound) {
    const from = { ...ringPos };
    const dx = REST.x - from.x;
    const dy = REST.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;      // 진행 방향에 수직인 단위 벡터 (흔들림용)
    const ny = dx / L;

    if (withSound) {
      const clicks = Math.max(4, Math.round(L / CLICK_STEP));
      for (let i = 0; i < clicks; i++) {
        // 감기는 속도에 맞춰 점점 느려지는 딸깍
        const t = 1 - Math.sqrt(1 - i / clicks);
        click((t * duration) / 1000, 0.3);
      }
    }

    return animate(duration, (t) => {
      const e = withSound ? 1 - Math.pow(1 - t, 2) : 1 - Math.pow(1 - t, 3);
      const wobble = withSound ? Math.sin(t * Math.PI * 9) * 6 * (1 - t) : 0;
      ringPos = {
        x: from.x + dx * e + nx * wobble,
        y: from.y + dy * e + ny * wobble,
      };
      render();
    });
  }

  // ---------- 화면 ----------

  function setBubble(text, cls) {
    bubble.textContent = text;
    bubble.className = 'bubble' + (cls ? ' ' + cls : '');
    bubble.hidden = false;
    void bubble.offsetWidth; // 애니메이션 재시작
    bubble.classList.add('pop');
  }

  function showThinking() {
    setBubble('…');
    hint.textContent = '';
  }

  function showAnswer(answer) {
    setBubble(answer);
    hint.textContent = answer === AGAIN ? '같은 질문을 다시 해 봐' : '다른 질문도 해 봐';
  }

  function showNotice(text) {
    setBubble(text, 'notice');
    hint.textContent = '고리를 잡고 멀리 당겼다가 놓아 봐';
  }

  function hideBubble() {
    bubble.hidden = true;
  }

  function addHistory(question, answer) {
    const li = document.createElement('li');
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = question;
    const a = document.createElement('span');
    a.className = 'a';
    a.textContent = answer;
    li.append(q, a);
    historyList.prepend(li);
    while (historyList.children.length > 5) historyList.lastChild.remove();
  }

  function updateSoundToggle() {
    soundToggle.setAttribute('aria-pressed', String(soundOn));
    soundToggle.textContent = soundOn ? '소리 켜짐' : '소리 꺼짐';
  }

  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem('conch-sound', soundOn ? 'on' : 'off'); } catch (_) {}
    if (!soundOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    updateSoundToggle();
  });

  // 일부 브라우저는 음성 목록을 늦게 불러옴
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  updateSoundToggle();
  render();
})();
