import pandas as pd
from sklearn.linear_model import LinearRegression
import pickle
from google.cloud import firestore

db = firestore.Client()

docs = db.collection('mldata').stream()
data = []

for doc in docs:
    data.append(doc.to_dict())

if len(data) == 0:
    print("No data available for training")
else:
    df = pd.DataFrame(data)

    # Drop 'userId' if it exists
    df = df.drop(columns=['userId'], errors='ignore')

    X = df[['em', 'im', 'edum', 'emim', 'loanm', 'inm', 'othm', 'ltgm', 'stgm', 'taxm']]

    # Train a model for each field
    models = {}
    for field in ['em', 'im', 'edum', 'emim', 'loanm', 'savem', 'inm', 'othm', 'ltgm', 'stgm', 'taxm']:
        y = df[field]
        model = LinearRegression()
        model.fit(X, y)
        models[field] = model

    # Save all models in a single pickle file
    with open('finance_model.pkl', 'wb') as f:
        pickle.dump(models, f)

    print("Model trained and saved successfully!")
