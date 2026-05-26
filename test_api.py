import subprocess, time, sys, os, json, urllib.request

api_path = r"C:\Users\20397\AppData\Roaming\Tencent\Marvis\User\oAN1i2ZjLT5YmQ9HqB9GvXbz5HPA\workspace\conv_19e4b810f7c_ce9c80399e5b\output\StudyPet\api_server.py"

# Kill all python
subprocess.run(['taskkill', '/f', '/im', 'python.exe'], capture_output=True)
time.sleep(2)

# Start new server
proc = subprocess.Popen([sys.executable, api_path], 
                       stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE,
                       cwd=os.path.dirname(api_path),
                       creationflags=subprocess.CREATE_NO_WINDOW)

time.sleep(4)

# Test
req = urllib.request.Request("http://127.0.0.1:19998/search?q=hello")
try:
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode())
    print("OK, got", len(data), "results" if isinstance(data, list) else data)
except Exception as e:
    print("Error:", e)
    # Check server output
    stdout, stderr = proc.communicate(timeout=2)
    print("STDOUT:", stdout.decode('utf-8', errors='ignore'))
    print("STDERR:", stderr.decode('utf-8', errors='ignore'))