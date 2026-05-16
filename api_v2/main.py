from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import chess
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 프론트엔드에서의 요청을 허용하기 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChessBoard(BaseModel):
    fen: str

@app.post("/analyze")
def analyze_position(board: ChessBoard):
    try:
        b = chess.Board(board.fen)
        
        attackers = []
        for square in chess.SQUARES:
            piece = b.piece_at(square)
            if piece:
                attackers_mask = b.attackers(not piece.color, square)
                for attacker_sq in attackers_mask:
                    attacker_piece = b.piece_at(attacker_sq)
                    attackers.append(
                        f"{'백' if piece.color else '흑'} {piece.symbol().upper()}({chess.square_name(square)})"
                        f"이 {'백' if attacker_piece.color else '흑'} {attacker_piece.symbol().upper()}({chess.square_name(attacker_sq)})"
                        f"의 공격을 받고 있습니다."
                    )
        
        pins = []
        for square in chess.SQUARES:
            if b.is_pinned(b.turn, square):
                pins.append(f"{chess.square_name(square)}칸의 기물은 핀에 의해 움직임이 제한됩니다.")
        
        return {
            "fen": board.fen,
            "facts": {
                "attackers": attackers,
                "pins": pins
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
