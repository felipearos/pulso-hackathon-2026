# Every time read goes through the demo clock

The live demo has to walk Patricia through weeks of citas, madrugada rules
and estado de cuenta cycles in five minutes, using the real flow rather than
a video. So the current time is a value stored in SQLite (America/Santiago)
that /demo can advance or reset, and every scheduling decision reads it;
code never calls `Date.now()` or `new Date()` for domain time. Faking time
per feature, or a separate demo mode, would let the demo diverge from what
Patricia actually gets.
