/** The all-claimed confetti burst, unchanged from the original bill page. */
export function Confetti() {
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {[...Array(50)].map((_, i) => (
        <div
          key={i}
          className="absolute w-3 h-3 rounded-sm"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: ['#4ade80', '#facc15', '#fb923c', '#f472b6', '#38bdf8'][
              Math.floor(Math.random() * 5)
            ],
            animation: `confetti-fall ${2 + Math.random() * 2}s linear forwards`,
            animationDelay: `${Math.random() * 0.5}s`,
          }}
        />
      ))}
    </div>
  );
}
