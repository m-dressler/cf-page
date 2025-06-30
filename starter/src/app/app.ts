import onDomReady from "jsr:@md/on-dom-ready";

/** Game state type */
type GameState = {
  running: boolean;
  player1Score: number;
  player2Score: number;
};

/** Ball type */
type Ball = {
  x: number;
  y: number;
  radius: number;
  velocityX: number;
  velocityY: number;
  speed: number;
};

/** Paddle type */
type Paddle = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

/** Keys state type */
type Keys = Record<string, boolean>;

/** Initialize game */
onDomReady(() => {
  const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const player1ScoreEl = document.getElementById("player1Score")!;
  const player2ScoreEl = document.getElementById("player2Score")!;
  const startBtn = document.getElementById("startBtn")!;

  /** Game state */
  const gameState: GameState = {
    running: false,
    player1Score: 0,
    player2Score: 0,
  };

  /** Ball object */
  const ball: Ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 10,
    velocityX: 5,
    velocityY: 3,
    speed: 5,
  };

  /** Paddle objects */
  const paddle1: Paddle = {
    x: 0,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
  };

  const paddle2: Paddle = {
    x: canvas.width - 10,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
  };

  /** Input handling */
  const keys: Keys = {};

  const handleKeyDown = (e: KeyboardEvent): void => {
    keys[e.key] = true;
  };

  const handleKeyUp = (e: KeyboardEvent): void => {
    keys[e.key] = false;
  };

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  /** Update paddle positions */
  const updatePaddles = (): void => {
    // Player 1 (W/S)
    if (keys["w"] || keys["W"]) {
      paddle1.y = Math.max(0, paddle1.y - 7);
    }
    if (keys["s"] || keys["S"]) {
      paddle1.y = Math.min(canvas.height - paddle1.height, paddle1.y + 7);
    }

    // Player 2 (Arrow keys)
    if (keys["ArrowUp"]) {
      paddle2.y = Math.max(0, paddle2.y - 7);
    }
    if (keys["ArrowDown"]) {
      paddle2.y = Math.min(canvas.height - paddle2.height, paddle2.y + 7);
    }
  };

  /** Check collision between ball and paddle */
  const checkCollision = (ball: Ball, paddle: Paddle): boolean => {
    return (
      ball.x < paddle.x + paddle.width &&
      ball.x + ball.radius > paddle.x &&
      ball.y < paddle.y + paddle.height &&
      ball.y + ball.radius > paddle.y
    );
  };

  /** Update ball position and handle collisions */
  const updateBall = (): void => {
    ball.x += ball.velocityX;
    ball.y += ball.velocityY;

    // Top and bottom collision
    if (ball.y + ball.radius > canvas.height || ball.y - ball.radius < 0) {
      ball.velocityY = -ball.velocityY;
    }

    // Paddle collisions
    if (checkCollision(ball, paddle1)) {
      ball.velocityX = -ball.velocityX;
      ball.x = paddle1.x + paddle1.width + ball.radius;
    }

    if (checkCollision(ball, paddle2)) {
      ball.velocityX = -ball.velocityX;
      ball.x = paddle2.x - ball.radius;
    }

    // Score points
    if (ball.x < 0) {
      gameState.player2Score++;
      player2ScoreEl.textContent = gameState.player2Score.toString();
      resetBall();
    }

    if (ball.x > canvas.width) {
      gameState.player1Score++;
      player1ScoreEl.textContent = gameState.player1Score.toString();
      resetBall();
    }
  };

  /** Reset ball to center */
  const resetBall = (): void => {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.velocityX = -ball.velocityX;
    ball.velocityY = Math.random() * 6 - 3;
  };

  /** Draw game objects */
  const draw = (): void => {
    // Clear canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw paddles
    ctx.fillStyle = "#fff";
    ctx.fillRect(paddle1.x, paddle1.y, paddle1.width, paddle1.height);
    ctx.fillRect(paddle2.x, paddle2.y, paddle2.width, paddle2.height);

    // Draw ball
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    // Draw center line
    ctx.setLineDash([5, 15]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  };

  /** Game loop */
  const gameLoop = (): void => {
    if (!gameState.running) return;

    updatePaddles();
    updateBall();
    draw();

    requestAnimationFrame(gameLoop);
  };

  /** Start/stop game */
  const toggleGame = (): void => {
    gameState.running = !gameState.running;
    startBtn.textContent = gameState.running ? "Stop Game" : "Start Game";

    if (gameState.running) {
      gameLoop();
    }
  };

  startBtn.addEventListener("click", toggleGame);

  // Initial draw
  draw();
});
