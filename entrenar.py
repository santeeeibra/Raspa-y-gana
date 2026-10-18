"""Entrena el recomendador de cortes y genera modelo.json.

Uso:  python3 entrenar.py
Para sumar un corte nuevo: agregalo en datos/entrenamiento.csv (en las
filas donde corresponda) y volvé a correr este archivo.
"""
import csv
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

AQUI = Path(__file__).parent
CSV = AQUI / "datos" / "entrenamiento.csv"
LISTA = AQUI / "datos" / "lista_cortes.txt"
SALIDA = AQUI / "modelo.json"

# columna del CSV -> id de la pregunta en guia.html
PREGUNTAS = {"rostro": "rostro", "pelo": "pelo", "objetivo": "objetivo", "mantenimiento": "mant"}
# el corte recomendado en 1er lugar pesa más que el 2do y el 3ro
PESOS_PUESTO = [3, 2, 1]

with open(CSV, encoding="utf-8-sig", newline="") as f:
    filas = list(csv.DictReader(f, delimiter=";"))

# Cada respuesta se vuelve una casilla "pregunta=valor" (0 o 1)
features = sorted({f"{q}={fila[col]}" for fila in filas for col, q in PREGUNTAS.items()})
indice = {nombre: i for i, nombre in enumerate(features)}

X, y, w = [], [], []
for fila in filas:
    x = np.zeros(len(features))
    for col, q in PREGUNTAS.items():
        x[indice[f"{q}={fila[col]}"]] = 1
    for puesto, peso in enumerate(PESOS_PUESTO, start=1):
        X.append(x)
        y.append(fila[f"corte_{puesto}"].strip())
        w.append(peso)

modelo = LogisticRegression(C=2.0, max_iter=2000)
modelo.fit(np.array(X), y, sample_weight=np.array(w))

cortes = [str(c) for c in modelo.classes_]

# Avisos útiles (no frenan el entrenamiento)
if LISTA.exists():
    oficiales = {l.strip() for l in LISTA.read_text(encoding="utf-8").split("LEYENDA")[0].splitlines()[1:] if l.strip()}
    for c in sorted(oficiales - set(cortes)):
        print(f"AVISO: '{c}' está en lista_cortes.txt pero no aparece en el CSV")
    for c in sorted(set(cortes) - oficiales):
        print(f"AVISO: '{c}' está en el CSV pero no en lista_cortes.txt")

salida = {
    "cortes": {
        c: {
            "intercepto": round(float(modelo.intercept_[i]), 4),
            "pesos": {n: round(float(modelo.coef_[i][j]), 4) for n, j in indice.items()},
        }
        for i, c in enumerate(cortes)
    }
}
SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")

# Chequeo: ¿el modelo acierta el corte nº1 del CSV?
aciertos = sum(
    modelo.predict(np.array([X[i * 3]]))[0] == fila["corte_1"].strip() for i, fila in enumerate(filas)
)
print(f"{len(cortes)} cortes, {len(filas)} filas. Acierta el 1er corte en {aciertos}/{len(filas)}.")
print(f"Guardado: {SALIDA.name}")
