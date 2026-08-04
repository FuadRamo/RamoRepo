import zlib
import base64
import urllib.request

mmd_file = "/home/dell/projects/Ramo Studio/Projects/Ramo_P2/RamoRepo/RamoRepo/planning/kb/Shahid/architecture_diagram.mmd"
png_file = "/home/dell/projects/Ramo Studio/Projects/Ramo_P2/RamoRepo/RamoRepo/planning/kb/Shahid/architecture_diagram.png"

with open(mmd_file, "r") as f:
    graph_code = f.read()

# Kroki uses zlib compression + urlsafe base64
compressed = zlib.compress(graph_code.encode("utf-8"), 9)
encoded = base64.urlsafe_b64encode(compressed).decode("utf-8")
url = f"https://kroki.io/mermaid/png/{encoded}"

print(f"Fetching PNG from Kroki: {url[:60]}...")
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
with urllib.request.urlopen(req) as response, open(png_file, "wb") as out_file:
    out_file.write(response.read())

print("Successfully generated architecture_diagram.png via Kroki!")
