# A code policy moves the etapa, not the LLM

Luna paces the escalera without a calendar, so something must decide when
Patricia moves up or back an etapa. The LLM only classifies what she sends
(emoji, text, voice note) into a closed list of intenciones; deterministic
rules in code turn those signals into an etapa move, and every move is logged
with its reason. We chose this over letting the model decide freely because
the product's promise is that AI extracts and drafts while code decides, the
moves must be testable and repeatable in a live demo, and the control room
has to show why she moved.
