// script.js
const state = {
    level: 2,
    playerColor: 'red',
    isPlaying: false,
    player: {
        deck: [],
        hand: [[], []],
        isDrawing: [false, false],
        penaltyUntil: 0
    },
    cpu: {
        deck: [],
        hand: [[], []],
        isDrawing: [false, false],
        penaltyUntil: 0
    },
    center: [[], []], // 中央の場2枠
    cpuTimer: null,
    stuckCheckTimer: null,
    stuckCountdownInterval: null,
    isStuckResolving: false
};

// --- DOM Elements ---
const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};
const btnStart = document.getElementById('start-btn');
const btnRetry = document.getElementById('retry-btn');
const btnBack = document.getElementById('back-btn');
const diffBtns = document.querySelectorAll('.diff-btn');
const colorBtns = document.querySelectorAll('.color-btn');

const domPlayerDeckCount = document.getElementById('player-deck-count');
const domCpuDeckCount = document.getElementById('cpu-deck-count');

const domHands = {
    player: [document.getElementById('player-hand-0'), document.getElementById('player-hand-1')],
    cpu: [document.getElementById('cpu-hand-0'), document.getElementById('cpu-hand-1')]
};
const domCenters = [document.getElementById('center-0'), document.getElementById('center-1')];

const domCountdown = document.getElementById('countdown-overlay');
const domCountdownText = document.getElementById('countdown-text');
const domStuckMessage = document.getElementById('stuck-message');

const playerPenaltyOverlay = document.getElementById('player-penalty');
const cpuPenaltyOverlay = document.getElementById('cpu-penalty');

// --- Utilities ---
const suits = ['hearts', 'diamonds', 'spades', 'clubs'];
const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'spades': '♠', 'clubs': '♣' };

function createColorDecks() {
    let redDeck = [];
    let blackDeck = [];
    const redSuits = ['hearts', 'diamonds'];
    const blackSuits = ['spades', 'clubs'];
    
    for (let s of redSuits) {
        for (let r = 1; r <= 13; r++) {
            redDeck.push({ suit: s, rank: r });
        }
    }
    for (let s of blackSuits) {
        for (let r = 1; r <= 13; r++) {
            blackDeck.push({ suit: s, rank: r });
        }
    }
    
    const offset = Math.floor(Math.random() * 13);
    const noiseLevel = 4; // ノイズを大幅に下げる(12→4)ことで、片方だけが大幅な「手札事故」を起こして詰むのを防止し、よりシーケンシャルにする

    const applyBias = (deck) => {
        deck.forEach(card => {
            let shifted = (card.rank + offset) % 13;
            // 揺らぎ(noise)を持たせてソートする
            card._sortWeight = shifted + (Math.random() * noiseLevel) + (Math.random() * 0.1);
        });
        deck.sort((a, b) => a._sortWeight - b._sortWeight);
        deck.forEach(card => delete card._sortWeight);
    };
    
    applyBias(redDeck);
    applyBias(blackDeck);
    
    return { red: redDeck, black: blackDeck };
}

function renderCard(card, isFacedown = false, stackedIndex = 0) {
    const template = document.getElementById('card-template').content.cloneNode(true);
    const cardEl = template.querySelector('.playing-card');
    
    if (stackedIndex > 0) {
        cardEl.classList.add(`stacked-${stackedIndex}`);
    }

    if (isFacedown) {
        cardEl.classList.add('is-facedown');
    } else {
        const isRed = (card.suit === 'hearts' || card.suit === 'diamonds');
        const front = cardEl.querySelector('.card-front');
        front.classList.add(isRed ? 'red' : 'black');

        let displayRank = card.rank;
        if (card.rank === 1) displayRank = 'A';
        if (card.rank === 11) displayRank = 'J';
        if (card.rank === 12) displayRank = 'Q';
        if (card.rank === 13) displayRank = 'K';

        cardEl.querySelectorAll('.card-number').forEach(el => el.textContent = displayRank);
        cardEl.querySelector('.card-suit').textContent = suitSymbols[card.suit];
    }
    return cardEl;
}

function updateUI() {
    domPlayerDeckCount.textContent = state.player.deck.length;
    domCpuDeckCount.textContent = state.cpu.deck.length;

    // 手札の描画
    [0, 1].forEach(i => renderStack(domHands.player[i], state.player.hand[i]));
    [0, 1].forEach(i => renderStack(domHands.cpu[i], state.cpu.hand[i]));

    // 場の描画
    [0, 1].forEach(i => renderStack(domCenters[i], state.center[i], true)); // 中央は一番上だけ見えれば十分だが、スタック表現を入れるなら入れる
}

function renderStack(container, stack, isCenter = false) {
    container.innerHTML = '';
    if (stack.length === 0) return;

    // 最大3枚まで描画して重なりを表現
    const startIdx = Math.max(0, stack.length - 3);
    for (let i = startIdx; i < stack.length; i++) {
        const card = stack[i];
        // 重なりインデックス (0, 1, 2...)
        const stackedIdx = Math.min(i - startIdx, 3);
        const cardEl = renderCard(card, false, isCenter ? 0 : stackedIdx);
        container.appendChild(cardEl);
    }
}

// --- Game Logic ---

function canPlay(handRank, centerRank) {
    if (!handRank || !centerRank) return false;
    const diff = Math.abs(handRank - centerRank);
    return diff === 1 || diff === 12; // 12 is for K(13) and A(1)
}

async function fillHandSlot(playerKey, slotIdx) {
    let pState = state[playerKey];
    if (pState.deck.length === 0) return;
    if (pState.hand[slotIdx].length > 0) return; 

    if (pState.isDrawing[slotIdx]) return;
    pState.isDrawing[slotIdx] = true;

    let card = pState.deck.pop();
    
    // スライド先の候補（既に同じ数字があるスロット）を探す
    let matchedOtherIdx = -1;
    for (let i of [0, 1]) {
        if (i === slotIdx) continue;
        let oStack = pState.hand[i];
        if (oStack.length > 0 && oStack[oStack.length - 1].rank === card.rank) {
            matchedOtherIdx = i;
            break;
        }
    }

    // 一度引いて場に置く
    pState.hand[slotIdx].push(card);
    updateUI();

    // 他方のスロットの一番上と同じ数字ならスライドの動き（待機）を挟む
    if (matchedOtherIdx !== -1) {
        let otherStack = pState.hand[matchedOtherIdx];
        
        // 少しそのまま見せてから移動する
        await new Promise(r => setTimeout(r, 400));
        
        // 待機中に他方のスロットが消費されていないか確認
        if (otherStack.length > 0 && otherStack[otherStack.length - 1].rank === card.rank) {
            pState.hand[slotIdx].pop();
            otherStack.push(card);
            updateUI();
            
            await new Promise(r => setTimeout(r, 150));
            pState.isDrawing[slotIdx] = false;
            fillHandSlot(playerKey, slotIdx); // 再帰的にもう1枚引く
            return;
        }
    }
    
    pState.isDrawing[slotIdx] = false;
}

function playCard(playerKey, handIdx) {
    if (!state.isPlaying) return false;

    const pState = state[playerKey];
    
    // ペナルティチェック
    if (Date.now() < pState.penaltyUntil) return false;

    const handStack = pState.hand[handIdx];
    if (handStack.length === 0 || pState.isDrawing[handIdx]) return false;

    const topCard = handStack[handStack.length - 1];

    // どのセンターに出せるかチェック
    let targetCenterIdx = -1;
    if (state.center[0].length > 0 && canPlay(topCard.rank, state.center[0][state.center[0].length - 1].rank)) {
        targetCenterIdx = 0;
    } else if (state.center[1].length > 0 && canPlay(topCard.rank, state.center[1][state.center[1].length - 1].rank)) {
        targetCenterIdx = 1;
    }

    if (targetCenterIdx !== -1) {
        // 出せる: 重なっている場合はスタックにあるカードを全てまとめて出す
        const cardsToPlay = handStack.splice(0, handStack.length);
        state.center[targetCenterIdx].push(...cardsToPlay);
        
        // 空になったら補充
        if (handStack.length === 0) {
            fillHandSlot(playerKey, handIdx);
        }
        updateUI();
        checkWinCondition();
        
        // アクションが起きたら手詰まりチェック
        clearTimeout(state.stuckCheckTimer);
        state.stuckCheckTimer = setTimeout(checkStuck, 1500); 
        return true;
    } else {
        // 出せないのにタップした -> ペナルティ
        if (playerKey === 'player') {
            applyPenalty('player');
        }
        return false;
    }
}

function applyPenalty(playerKey) {
    const pState = state[playerKey];
    pState.penaltyUntil = Date.now() + 5000;
    
    const overlay = playerKey === 'player' ? playerPenaltyOverlay : cpuPenaltyOverlay;
    const timeSpan = overlay.querySelector('.penalty-time');
    overlay.classList.remove('hidden');
    overlay.classList.add('penalty-lock');
    
    let timeLeft = 5;
    timeSpan.textContent = timeLeft;
    
    const interval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0 || !state.isPlaying) {
            clearInterval(interval);
            overlay.classList.add('hidden');
            overlay.classList.remove('penalty-lock');
        } else {
            timeSpan.textContent = timeLeft;
        }
    }, 1000);
}

function hasPlayableCard(playerKey) {
    // ペナルティ関係なく、出せるカードがあるかチェックする
    const pState = state[playerKey];
    for (let cIdx = 0; cIdx <= 1; cIdx++) {
        if (state.center[cIdx].length === 0) continue;
        const cRank = state.center[cIdx][state.center[cIdx].length - 1].rank;
        for (let hIdx = 0; hIdx <= 1; hIdx++) {
            if (pState.hand[hIdx].length > 0) {
                const hRank = pState.hand[hIdx][pState.hand[hIdx].length - 1].rank;
                if (canPlay(hRank, cRank)) return true;
            }
        }
    }
    return false;
}

function checkStuck() {
    if (!state.isPlaying || state.isStuckResolving) return;
    
    // 補充アニメーション中は手詰まり判定を保留
    let isAnyDrawing = false;
    for (let i=0; i<2; i++) {
        if (state.player.isDrawing[i] || state.cpu.isDrawing[i]) isAnyDrawing = true;
    }
    if (isAnyDrawing) return;
    
    if (!hasPlayableCard('player') && !hasPlayableCard('cpu')) {
        // 完全に手詰まり
        state.isStuckResolving = true;
        domStuckMessage.classList.remove('hidden');
        
        let count = 3;
        domStuckMessage.textContent = `補充まで: ${count}秒`;

        state.stuckCountdownInterval = setInterval(() => {
            count--;
            if (count > 0) {
                domStuckMessage.textContent = `補充まで: ${count}秒`;
            } else {
                clearInterval(state.stuckCountdownInterval);
                domStuckMessage.classList.add('hidden');
                domStuckMessage.textContent = "手詰まり - 自動補充";
                
                if (!state.isPlaying) {
                    state.isStuckResolving = false;
                    return;
                }
                resolveStuck();
                state.isStuckResolving = false;
            }
        }, 1000);
    }
}

function resolveStuck() {
    // 山札がなくなった場合は補充はせず、手札の枚数が少ない方が勝ち、同じ枚数なら引き分け
    if (state.player.deck.length === 0 || state.cpu.deck.length === 0) {
        const getCardCount = (pKey) => state[pKey].deck.length + state[pKey].hand.reduce((acc, stack) => acc + stack.length, 0);
        const pCards = getCardCount('player');
        const cCards = getCardCount('cpu');
        
        if (pCards < cCards) {
            endGame('player');
        } else if (pCards > cCards) {
            endGame('cpu');
        } else {
            endGame('draw');
        }
        return;
    }

    // 互いに山札から1枚ずつ場に出す
    ['player', 'cpu'].forEach((playerKey, cIdx) => {
        let pState = state[playerKey];
        if (pState.deck.length > 0) {
            state.center[cIdx].push(pState.deck.pop());
        }
    });

    updateUI();
    // 補充した結果、手札が空で補充できるならする
    [0, 1].forEach(i => {
        if(state.player.hand[i].length === 0) fillHandSlot('player', i);
        if(state.cpu.hand[i].length === 0) fillHandSlot('cpu', i);
    });
    updateUI();
    
    // 再度チェック
    clearTimeout(state.stuckCheckTimer);
    state.stuckCheckTimer = setTimeout(checkStuck, 1500); 
}

function checkWinCondition() {
    const isHandEmpty = (pKey) => state[pKey].hand.every(stack => stack.length === 0);
    const playerEmpty = state.player.deck.length === 0 && isHandEmpty('player');
    const cpuEmpty = state.cpu.deck.length === 0 && isHandEmpty('cpu');

    if (playerEmpty || cpuEmpty) {
        endGame(playerEmpty ? 'player' : 'cpu');
    }
}

// --- AI Logic ---
function cpuAction() {
    if (!state.isPlaying) return;

    // AIの難易度に応じた次の行動までの間隔(ms)
    // 1:弱い(1500~2500ms), 2:普通(1000~1500ms), 3:強い(600~1000ms), 4:最強(300~600ms)
    let baseDelay, randDelay;
    switch(state.level) {
        case 1: baseDelay = 1500; randDelay = 1000; break;
        case 2: baseDelay = 1000; randDelay = 500; break;
        case 3: baseDelay = 600; randDelay = 400; break;
        case 4: baseDelay = 300; randDelay = 300; break;
        default: baseDelay = 1000; randDelay = 500;
    }
    const nextActionTime = baseDelay + Math.random() * randDelay;

    // 行動
    if (Date.now() >= state.cpu.penaltyUntil) {
        // ランダムに行動をチェック
        let checkOrder = [0, 1];
        // Fisher-Yates shuffle
        for (let k = checkOrder.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [checkOrder[k], checkOrder[j]] = [checkOrder[j], checkOrder[k]];
        }
        
        let moved = false;
        for (let hIdx of checkOrder) {
            const hStack = state.cpu.hand[hIdx];
            if (hStack.length === 0 || state.cpu.isDrawing[hIdx]) continue;
            
            const topCard = hStack[hStack.length - 1];
            // センターもランダムチェック
            const centerOrder = Math.random() > 0.5 ? [0, 1] : [1, 0];
            for (let cIdx of centerOrder) {
                if (state.center[cIdx].length > 0) {
                    const cCard = state.center[cIdx][state.center[cIdx].length - 1];
                    if (canPlay(topCard.rank, cCard.rank)) {
                        // 出せる: まとめて出す
                        const cardsToPlay = hStack.splice(0, hStack.length);
                        state.center[cIdx].push(...cardsToPlay);
                        
                        if (hStack.length === 0) fillHandSlot('cpu', hIdx);
                        updateUI();
                        checkWinCondition();
                        moved = true;
                        
                        // 動いたので手詰まりタイマーリセット
                        clearTimeout(state.stuckCheckTimer);
                        state.stuckCheckTimer = setTimeout(checkStuck, 1500);
                        break;
                    }
                }
            }
            if (moved) break;
        }
        
        // たまにミスをする（レベルが低いほどミスりやすい）
        if (!moved) {
            const mistakeChance = { 1: 0.1, 2: 0.05, 3: 0.01, 4: 0 }[state.level] || 0;
            if (Math.random() < mistakeChance) {
                applyPenalty('cpu');
            }
        }
    }

    if (state.isPlaying) {
        state.cpuTimer = setTimeout(cpuAction, nextActionTime);
    }
}

// --- Game Flow ---

function switchScreen(screenName) {
    Object.values(screens).forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    screens[screenName].classList.remove('hidden');
    screens[screenName].classList.add('active');
}

function initGame() {
    const decks = createColorDecks();
    
    // Reset stuck state
    if (state.stuckCountdownInterval) clearInterval(state.stuckCountdownInterval);
    state.isStuckResolving = false;
    domStuckMessage.classList.add('hidden');
    
    if (state.playerColor === 'red') {
        state.player.deck = decks.red;
        state.cpu.deck = decks.black;
    } else {
        state.player.deck = decks.black;
        state.cpu.deck = decks.red;
    }
    
    state.cpu.hand = [[], []];
    state.player.hand = [[], []];
    state.center = [[], []];
    
    state.cpu.isDrawing = [false, false];
    state.player.isDrawing = [false, false];
    state.cpu.penaltyUntil = 0;
    state.player.penaltyUntil = 0;
    
    playerPenaltyOverlay.classList.add('hidden');
    cpuPenaltyOverlay.classList.add('hidden');

    // お互いが場に1枚ずつ出す
    state.center[0].push(state.player.deck.pop());
    state.center[1].push(state.cpu.deck.pop());

    // 手札を2枚ずつにする（重ね補充ルール込み）
    [0, 1].forEach(i => fillHandSlot('player', i));
    [0, 1].forEach(i => fillHandSlot('cpu', i));

    updateUI();
}

function startGame() {
    initGame();
    switchScreen('game');
    
    // カウントダウン
    domCountdown.classList.remove('hidden');
    
    let count = 3;
    domCountdownText.textContent = count;
    
    const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            domCountdownText.textContent = count;
            domCountdownText.style.animation = 'none';
            void domCountdownText.offsetWidth; // trigger reflow
            domCountdownText.style.animation = 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        } else if (count === 0) {
            domCountdownText.textContent = "START!";
        } else {
            clearInterval(countInterval);
            domCountdown.classList.add('hidden');
            
            // ゲーム開始
            state.isPlaying = true;
            state.stuckCheckTimer = setTimeout(checkStuck, 1500); 
            cpuAction(); // AI起動
        }
    }, 1000);
}

function endGame(winner) {
    state.isPlaying = false;
    clearTimeout(state.cpuTimer);
    clearTimeout(state.stuckCheckTimer);
    if (state.stuckCountdownInterval) clearInterval(state.stuckCountdownInterval);
    state.isStuckResolving = false;
    domStuckMessage.classList.add('hidden');
    
    const resTitle = document.getElementById('result-title');
    const lvls = ['弱い', '普通', '強い', '最強'];
    document.getElementById('result-diff').textContent = lvls[state.level - 1];
    
    const getCardCount = (pKey) => state[pKey].deck.length + state[pKey].hand.reduce((acc, stack) => acc + stack.length, 0);
    document.getElementById('res-player-deck').textContent = getCardCount('player');
    document.getElementById('res-cpu-deck').textContent = getCardCount('cpu');

    // クラスをリセット
    resTitle.className = 'result-title';
    
    if (winner === 'player') {
        resTitle.textContent = "YOU WIN!";
    } else if (winner === 'cpu') {
        resTitle.textContent = "YOU LOSE...";
        resTitle.classList.add('lose');
    } else {
        resTitle.textContent = "DRAW";
        resTitle.classList.add('draw');
    }
    
    setTimeout(() => {
        switchScreen('result');
    }, 1000);
}

// --- Event Listeners ---

diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        diffBtns.forEach(b => b.classList.remove('selected'));
        const target = e.target;
        target.classList.add('selected');
        state.level = parseInt(target.dataset.level);
    });
});

colorBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        colorBtns.forEach(b => b.classList.remove('selected'));
        const target = e.currentTarget;
        target.classList.add('selected');
        state.playerColor = target.dataset.color;
    });
});

btnStart.addEventListener('click', startGame);

btnRetry.addEventListener('click', startGame);

btnBack.addEventListener('click', () => {
    switchScreen('start');
});

domHands.player[0].addEventListener('click', () => playCard('player', 0));
domHands.player[1].addEventListener('click', () => playCard('player', 1));
domHands.player[0].addEventListener('touchstart', (e) => { e.preventDefault(); playCard('player', 0); }, {passive: false});
domHands.player[1].addEventListener('touchstart', (e) => { e.preventDefault(); playCard('player', 1); }, {passive: false});

// 初回ロード
switchScreen('start');
