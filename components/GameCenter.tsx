import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface GameCenterProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
}

interface GameOption {
    id: string;
    name: string;
    icon: string;
    url?: string;
    srcDoc?: string;
    description: string;
}

const TETRIS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Basic Tetris HTML Game</title>
  <meta charset="UTF-8">
  <style>
  html, body { height: 100%; margin: 0; }
  body { background: black; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { border: 1px solid white; }
  </style>
</head>
<body>
<canvas width="320" height="640" id="game"></canvas>
<script>
function getRandomInt(min, max) { min = Math.ceil(min); max = Math.floor(max); return Math.floor(Math.random() * (max - min + 1)) + min; }
function generateSequence() { const sequence = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']; while (sequence.length) { const rand = getRandomInt(0, sequence.length - 1); const name = sequence.splice(rand, 1)[0]; tetrominoSequence.push(name); } }
function getNextTetromino() { if (tetrominoSequence.length === 0) { generateSequence(); } const name = tetrominoSequence.pop(); const matrix = tetrominos[name]; const col = playfield[0].length / 2 - Math.ceil(matrix[0].length / 2); const row = name === 'I' ? -1 : -2; return { name, matrix, row, col }; }
function rotate(matrix) { const N = matrix.length - 1; return matrix.map((row, i) => row.map((val, j) => matrix[N - j][i])); }
function isValidMove(matrix, cellRow, cellCol) { for (let row = 0; row < matrix.length; row++) { for (let col = 0; col < matrix[row].length; col++) { if (matrix[row][col] && (cellCol + col < 0 || cellCol + col >= playfield[0].length || cellRow + row >= playfield.length || playfield[cellRow + row][cellCol + col])) return false; } } return true; }
function placeTetromino() { for (let row = 0; row < tetromino.matrix.length; row++) { for (let col = 0; col < tetromino.matrix[row].length; col++) { if (tetromino.matrix[row][col]) { if (tetromino.row + row < 0) return showGameOver(); playfield[tetromino.row + row][tetromino.col + col] = tetromino.name; } } } for (let row = playfield.length - 1; row >= 0; ) { if (playfield[row].every(cell => !!cell)) { for (let r = row; r >= 0; r--) { for (let c = 0; c < playfield[r].length; c++) { playfield[r][c] = playfield[r-1][c]; } } } else { row--; } } tetromino = getNextTetromino(); }
function showGameOver() { cancelAnimationFrame(rAF); gameOver = true; context.fillStyle = 'black'; context.globalAlpha = 0.75; context.fillRect(0, canvas.height / 2 - 30, canvas.width, 60); context.globalAlpha = 1; context.fillStyle = 'white'; context.font = '36px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('GAME OVER!', canvas.width / 2, canvas.height / 2); }
const canvas = document.getElementById('game'); const context = canvas.getContext('2d'); const grid = 32; const tetrominoSequence = []; const playfield = []; for (let row = -2; row < 20; row++) { playfield[row] = []; for (let col = 0; col < 10; col++) { playfield[row][col] = 0; } }
const tetrominos = { 'I': [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], 'J': [[1,0,0],[1,1,1],[0,0,0]], 'L': [[0,0,1],[1,1,1],[0,0,0]], 'O': [[1,1],[1,1]], 'S': [[0,1,1],[1,1,0],[0,0,0]], 'Z': [[1,1,0],[0,1,1],[0,0,0]], 'T': [[0,1,0],[1,1,1],[0,0,0]] };
const colors = { 'I': 'cyan', 'O': 'yellow', 'T': 'purple', 'S': 'green', 'Z': 'red', 'J': 'blue', 'L': 'orange' };
let count = 0; let tetromino = getNextTetromino(); let rAF = null; let gameOver = false;
function loop() { rAF = requestAnimationFrame(loop); context.clearRect(0,0,canvas.width,canvas.height); for (let row = 0; row < 20; row++) { for (let col = 0; col < 10; col++) { if (playfield[row][col]) { const name = playfield[row][col]; context.fillStyle = colors[name]; context.fillRect(col * grid, row * grid, grid-1, grid-1); } } } if (tetromino) { if (++count > 35) { tetromino.row++; count = 0; if (!isValidMove(tetromino.matrix, tetromino.row, tetromino.col)) { tetromino.row--; placeTetromino(); } } context.fillStyle = colors[tetromino.name]; for (let row = 0; row < tetromino.matrix.length; row++) { for (let col = 0; col < tetromino.matrix[row].length; col++) { if (tetromino.matrix[row][col]) { context.fillRect((tetromino.col + col) * grid, (tetromino.row + row) * grid, grid-1, grid-1); } } } } }
document.addEventListener('keydown', function(e) { if (gameOver) return; if (e.which === 37 || e.which === 39) { const col = e.which === 37 ? tetromino.col - 1 : tetromino.col + 1; if (isValidMove(tetromino.matrix, tetromino.row, col)) tetromino.col = col; } if (e.which === 38) { const matrix = rotate(tetromino.matrix); if (isValidMove(matrix, tetromino.row, tetromino.col)) tetromino.matrix = matrix; } if(e.which === 40) { const row = tetromino.row + 1; if (!isValidMove(tetromino.matrix, row, tetromino.col)) { tetromino.row = row - 1; placeTetromino(); return; } tetromino.row = row; } });
rAF = requestAnimationFrame(loop);
</script>
</body>
</html>`;

const SNAKE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Basic Snake HTML Game</title>
  <meta charset="UTF-8">
  <style>
  html, body { height: 100%; margin: 0; }
  body { background: black; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { border: 1px solid white; }
  </style>
</head>
<body>
<canvas width="400" height="400" id="game"></canvas>
<script>
var canvas = document.getElementById('game'); var context = canvas.getContext('2d'); var grid = 16; var count = 0;
var snake = { x: 160, y: 160, dx: grid, dy: 0, cells: [], maxCells: 4 };
var apple = { x: 320, y: 320 };
function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min)) + min; }
function loop() { requestAnimationFrame(loop); if (++count < 4) return; count = 0; context.clearRect(0,0,canvas.width,canvas.height); snake.x += snake.dx; snake.y += snake.dy; if (snake.x < 0) snake.x = canvas.width - grid; else if (snake.x >= canvas.width) snake.x = 0; if (snake.y < 0) snake.y = canvas.height - grid; else if (snake.y >= canvas.height) snake.y = 0; snake.cells.unshift({x: snake.x, y: snake.y}); if (snake.cells.length > snake.maxCells) snake.cells.pop(); context.fillStyle = 'red'; context.fillRect(apple.x, apple.y, grid-1, grid-1); context.fillStyle = 'green'; snake.cells.forEach(function(cell, index) { context.fillRect(cell.x, cell.y, grid-1, grid-1); if (cell.x === apple.x && cell.y === apple.y) { snake.maxCells++; apple.x = getRandomInt(0, 25) * grid; apple.y = getRandomInt(0, 25) * grid; } for (var i = index + 1; i < snake.cells.length; i++) { if (cell.x === snake.cells[i].x && cell.y === snake.cells[i].y) { snake.x = 160; snake.y = 160; snake.cells = []; snake.maxCells = 4; snake.dx = grid; snake.dy = 0; apple.x = getRandomInt(0, 25) * grid; apple.y = getRandomInt(0, 25) * grid; } } }); }
document.addEventListener('keydown', function(e) { if (e.which === 37 && snake.dx === 0) { snake.dx = -grid; snake.dy = 0; } else if (e.which === 38 && snake.dy === 0) { snake.dy = -grid; snake.dx = 0; } else if (e.which === 39 && snake.dx === 0) { snake.dx = grid; snake.dy = 0; } else if (e.which === 40 && snake.dy === 0) { snake.dy = grid; snake.dx = 0; } });
requestAnimationFrame(loop);
</script>
</body>
</html>`;

const PONG_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Basic Pong HTML Game</title>
  <meta charset="UTF-8">
  <style>
  html, body { height: 100%; margin: 0; }
  body { background: black; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { border: 1px solid white; }
  </style>
</head>
<body>
<canvas width="750" height="585" id="game"></canvas>
<script>
const canvas = document.getElementById('game'); const context = canvas.getContext('2d'); const grid = 15; const paddleHeight = grid * 5; const maxPaddleY = canvas.height - grid - paddleHeight; var paddleSpeed = 6; var ballSpeed = 5;
const leftPaddle = { x: grid * 2, y: canvas.height / 2 - paddleHeight / 2, width: grid, height: paddleHeight, dy: 0 };
const rightPaddle = { x: canvas.width - grid * 3, y: canvas.height / 2 - paddleHeight / 2, width: grid, height: paddleHeight, dy: 0 };
const ball = { x: canvas.width / 2, y: canvas.height / 2, width: grid, height: grid, resetting: false, dx: ballSpeed, dy: -ballSpeed };
function collides(obj1, obj2) { return obj1.x < obj2.x + obj2.width && obj1.x + obj1.width > obj2.x && obj1.y < obj2.y + obj2.height && obj1.y + obj1.height > obj2.y; }
function loop() { requestAnimationFrame(loop); context.clearRect(0,0,canvas.width,canvas.height); leftPaddle.y += leftPaddle.dy; rightPaddle.y += rightPaddle.dy; if (leftPaddle.y < grid) leftPaddle.y = grid; else if (leftPaddle.y > maxPaddleY) leftPaddle.y = maxPaddleY; if (rightPaddle.y < grid) rightPaddle.y = grid; else if (rightPaddle.y > maxPaddleY) rightPaddle.y = maxPaddleY; context.fillStyle = 'white'; context.fillRect(leftPaddle.x, leftPaddle.y, leftPaddle.width, leftPaddle.height); context.fillRect(rightPaddle.x, rightPaddle.y, rightPaddle.width, rightPaddle.height); ball.x += ball.dx; ball.y += ball.dy; if (ball.y < grid) { ball.y = grid; ball.dy *= -1; } else if (ball.y + grid > canvas.height - grid) { ball.y = canvas.height - grid * 2; ball.dy *= -1; } if ((ball.x < 0 || ball.x > canvas.width) && !ball.resetting) { ball.resetting = true; setTimeout(() => { ball.resetting = false; ball.x = canvas.width / 2; ball.y = canvas.height / 2; }, 400); } if (collides(ball, leftPaddle)) { ball.dx *= -1; ball.x = leftPaddle.x + leftPaddle.width; } else if (collides(ball, rightPaddle)) { ball.dx *= -1; ball.x = rightPaddle.x - ball.width; } context.fillRect(ball.x, ball.y, ball.width, ball.height); context.fillStyle = 'lightgrey'; context.fillRect(0, 0, canvas.width, grid); context.fillRect(0, canvas.height - grid, canvas.width, canvas.height); for (let i = grid; i < canvas.height - grid; i += grid * 2) { context.fillRect(canvas.width / 2 - grid / 2, i, grid, grid); } }
document.addEventListener('keydown', function(e) { if (e.which === 38) rightPaddle.dy = -paddleSpeed; else if (e.which === 40) rightPaddle.dy = paddleSpeed; if (e.which === 87) leftPaddle.dy = -paddleSpeed; else if (e.which === 83) leftPaddle.dy = paddleSpeed; });
document.addEventListener('keyup', function(e) { if (e.which === 38 || e.which === 40) rightPaddle.dy = 0; if (e.which === 83 || e.which === 87) leftPaddle.dy = 0; });
requestAnimationFrame(loop);
</script>
</body>
</html>`;

const BREAKOUT_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Basic Breakout HTML Game</title>
  <meta charset="UTF-8">
  <style>
  html, body { height: 100%; margin: 0; }
  body { background: black; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { border: 1px solid white; }
  </style>
</head>
<body>
<canvas width="400" height="500" id="game"></canvas>
<script>
const canvas = document.getElementById('game'); const context = canvas.getContext('2d');
const level1 = [[],[],[],[],[],[],['R','R','R','R','R','R','R','R','R','R','R','R','R','R'],['R','R','R','R','R','R','R','R','R','R','R','R','R','R'],['O','O','O','O','O','O','O','O','O','O','O','O','O','O'],['O','O','O','O','O','O','O','O','O','O','O','O','O','O'],['G','G','G','G','G','G','G','G','G','G','G','G','G','G'],['G','G','G','G','G','G','G','G','G','G','G','G','G','G'],['Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y'],['Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y']];
const colorMap = { 'R': 'red', 'O': 'orange', 'G': 'green', 'Y': 'yellow' };
const brickGap = 2; const brickWidth = 25; const brickHeight = 12; const wallSize = 12; const bricks = [];
for (let row = 0; row < level1.length; row++) { for (let col = 0; col < level1[row].length; col++) { const colorCode = level1[row][col]; bricks.push({ x: wallSize + (brickWidth + brickGap) * col, y: wallSize + (brickHeight + brickGap) * row, color: colorMap[colorCode], width: brickWidth, height: brickHeight }); } }
const paddle = { x: canvas.width / 2 - brickWidth / 2, y: 440, width: brickWidth, height: brickHeight, dx: 0 };
const ball = { x: 130, y: 260, width: 5, height: 5, speed: 2, dx: 0, dy: 0 };
function collides(obj1, obj2) { return obj1.x < obj2.x + obj2.width && obj1.x + obj1.width > obj2.x && obj1.y < obj2.y + obj2.height && obj1.y + obj1.height > obj2.y; }
function loop() { requestAnimationFrame(loop); context.clearRect(0,0,canvas.width,canvas.height); paddle.x += paddle.dx; if (paddle.x < wallSize) paddle.x = wallSize; else if (paddle.x + brickWidth > canvas.width - wallSize) paddle.x = canvas.width - wallSize - brickWidth; ball.x += ball.dx; ball.y += ball.dy; if (ball.x < wallSize) { ball.x = wallSize; ball.dx *= -1; } else if (ball.x + ball.width > canvas.width - wallSize) { ball.x = canvas.width - wallSize - ball.width; ball.dx *= -1; } if (ball.y < wallSize) { ball.y = wallSize; ball.dy *= -1; } if (ball.y > canvas.height) { ball.x = 130; ball.y = 260; ball.dx = 0; ball.dy = 0; } if (collides(ball, paddle)) { ball.dy *= -1; ball.y = paddle.y - ball.height; } for (let i = 0; i < bricks.length; i++) { const brick = bricks[i]; if (collides(ball, brick)) { bricks.splice(i, 1); if (ball.y + ball.height - ball.speed <= brick.y || ball.y >= brick.y + brick.height - ball.speed) ball.dy *= -1; else ball.dx *= -1; break; } } context.fillStyle = 'lightgrey'; context.fillRect(0, 0, canvas.width, wallSize); context.fillRect(0, 0, wallSize, canvas.height); context.fillRect(canvas.width - wallSize, 0, wallSize, canvas.height); if (ball.dx || ball.dy) context.fillRect(ball.x, ball.y, ball.width, ball.height); bricks.forEach(function(brick) { context.fillStyle = brick.color; context.fillRect(brick.x, brick.y, brick.width, brick.height); }); context.fillStyle = 'cyan'; context.fillRect(paddle.x, paddle.y, paddle.width, paddle.height); }
document.addEventListener('keydown', function(e) { if (e.which === 37) paddle.dx = -3; else if (e.which === 39) paddle.dx = 3; if (ball.dx === 0 && ball.dy === 0 && e.which === 32) { ball.dx = ball.speed; ball.dy = ball.speed; } });
document.addEventListener('keyup', function(e) { if (e.which === 37 || e.which === 39) paddle.dx = 0; });
requestAnimationFrame(loop);
</script>
</body>
</html>`;

const GAMES: GameOption[] = [
    {
        id: 'flappybird',
        name: 'Flappy Bird',
        icon: '🐦',
        url: 'https://flappybird.io/',
        description: 'Tap to fly through pipes'
    },
    {
        id: 'basketball',
        name: 'Basketball',
        icon: '🏀',
        url: 'https://html-classic.itch.zone/html/3187507/index.html',
        description: 'Shoot some hoops'
    },
    {
        id: 'breakout',
        name: 'Breakout',
        icon: '🛹',
        srcDoc: BREAKOUT_HTML,
        description: 'Smash the bricks'
    },
    {
        id: 'asterdots',
        name: 'Asterdots',
        icon: '⚪',
        url: 'https://html-classic.itch.zone/html/6224283-601820/index.html',
        description: 'Space arena shooter'
    },
    {
        id: 'snake',
        name: 'Snake',
        icon: '🐍',
        srcDoc: SNAKE_HTML,
        description: 'Classic arcade snake'
    },
    {
        id: 'tetris',
        name: 'Tetris',
        icon: '🧱',
        srcDoc: TETRIS_HTML,
        description: 'Stack falling blocks'
    }
];

export const GameCenter: React.FC<GameCenterProps> = ({ isOpen, onClose, isDarkMode }) => {
    const [selectedGame, setSelectedGame] = useState<GameOption | null>(null);

    if (!isOpen) return null;

    const handleGameSelect = (game: GameOption) => {
        setSelectedGame(game);
    };

    const handleCloseGame = () => {
        setSelectedGame(null);
    };

    const handleCloseAll = () => {
        setSelectedGame(null);
        onClose();
    };

    // Fullscreen Game View
    if (selectedGame) {
        return createPortal(
            <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
                {/* Header Bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#1d1d1f] border-b border-[#3d3d3f]">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleCloseGame}
                            className="p-2 rounded-xl bg-[#2d2d2f] hover:bg-[#3d3d3f] text-white transition-colors"
                            title="Back to Games"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <span className="text-2xl">{selectedGame.icon}</span>
                        <span className="text-white font-semibold text-lg">{selectedGame.name}</span>
                    </div>
                    <button
                        onClick={handleCloseAll}
                        className="p-2 rounded-xl bg-red-500/20 hover:bg-red-500/40 text-red-400 hover:text-red-300 transition-colors"
                        title="Close Game Center"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {/* Game iframe */}
                <iframe
                    src={selectedGame.url}
                    srcDoc={selectedGame.srcDoc}
                    className="flex-1 w-full border-none"
                    title={selectedGame.name}
                    allow="autoplay; fullscreen"
                />
            </div>,
            document.body
        );
    }

    // Game Selection Modal
    return createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />
            {/* Modal */}
            <div className={`relative z-10 w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">🎮</span>
                        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Game Center</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'}`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {/* Game Grid */}
                <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {GAMES.map((game) => (
                            <button
                                key={game.id}
                                onClick={() => handleGameSelect(game)}
                                className={`group relative p-5 rounded-2xl text-left transition-all duration-300 hover:scale-[1.03] ${isDarkMode
                                    ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] border border-[#3d3d3f] hover:border-[#5d5d5f]'
                                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300'
                                    }`}
                            >
                                <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform">{game.icon}</span>
                                <h3 className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{game.name}</h3>
                                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{game.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
                {/* Footer */}
                <div className={`px-6 py-4 border-t text-center ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        Take a break and have some fun! 🎉
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
};
