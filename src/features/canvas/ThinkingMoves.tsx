const moves = [
  { name: "Explore", icon: "↗", text: "Explore this idea from three distinct perspectives. Give me a spatial map of the possibilities and surface an unexpected connection." },
  { name: "Challenge", icon: "◈", text: "Challenge the assumptions here. What might be wrong, what evidence would change our minds, and what is the strongest alternative?" },
  { name: "Synthesize", icon: "⋈", text: "Bring these ideas together. Identify the common ground, unresolved tensions, and one concrete experiment that would help us decide." },
];
export const ThinkingMoves = ({ instruction, onChange }: { instruction: string; onChange: (text: string) => void }) => <div className="thinking-moves" aria-label="Thinking moves">{moves.map((move) => <button type="button" key={move.name} title={move.text} onClick={() => onChange(instruction.trim() ? `${instruction.trim()}\n\n${move.text}` : move.text)}><span aria-hidden="true">{move.icon}</span>{move.name}</button>)}</div>;
