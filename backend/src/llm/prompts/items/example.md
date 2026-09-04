A short example for the concept "stomata" (a plant's gas-exchange pores):

```json
{
  "topic": "stomata",
  "items": [
    { "type": "recall", "prompt": "What are stomata?", "answer": "pores in a leaf that let gas in and out", "accept": ["small openings on leaves for gas exchange", "leaf pores"], "isTransfer": false },
    { "type": "recognition", "prompt": "Which gas do stomata primarily let INTO the leaf during the day?", "options": ["Oxygen", "Nitrogen", "Carbon dioxide", "Water vapor"], "answerIndex": 2, "isTransfer": false },
    { "type": "application", "prompt": "A plant's stomata are forced shut all day by a wax coating. What immediate problem does this cause for photosynthesis?", "answer": "no CO2 can enter, so the Calvin cycle stalls", "accept": ["carbon dioxide intake stops", "photosynthesis slows from lack of CO2"], "isTransfer": true },
    { "type": "explain", "prompt": "Explain why stomata usually close at night.", "rubric": "Should mention no light means no photosynthesis, so CO2 isn't needed and closing reduces water loss.", "isTransfer": false }
  ]
}
```

This is 4 items for illustration; a real response has 6–8, still with all four types present and 1–2 marked transfer.
