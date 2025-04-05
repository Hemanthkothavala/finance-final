import sys
import pickle
import numpy as np
import json  # Import json for proper serialization

# Load the trained models
with open("finance_model.pkl", "rb") as f:
    models = pickle.load(f)

# Convert input arguments to a NumPy array
inputs = np.array([float(x) for x in sys.argv[1:]]).reshape(1, -1)

# Make predictions
predictions = {}
for field, model in models.items():
    predictions[field] = float(model.predict(inputs)[0])  # Convert np.float64 to float

# Print valid JSON output
print(json.dumps(predictions))  # Convert dictionary to JSON format
