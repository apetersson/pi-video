import json, os, time
from pathlib import Path
from urllib.request import Request, urlopen
root=Path(__file__).resolve().parent.parent
base=os.environ['PI_VIDEO_TEST_BASE_URL'].rstrip('/')
key=os.environ.get('PI_VIDEO_TEST_API_KEY','')
headers={'Authorization':'Bearer '+key} if key else {}
for attempt in range(60):
    try:
        with urlopen(Request(base+'/models',headers=headers),timeout=5) as response:
            data=json.load(response)
        break
    except Exception:
        if attempt==59: raise
        time.sleep(1)
model=os.environ.get('PI_VIDEO_TEST_MODEL') or data['data'][0]['id']
config={'providers':{'video-test':{'baseUrl':base,'api':'openai-completions','apiKey':key or 'local','compat':{'supportsDeveloperRole':False,'supportsReasoningEffort':False},'models':[{'id':model,'name':'Video test','input':['text','image'],'contextWindow':262144,'maxTokens':1024,'reasoning':False}]}}}
agent=Path(os.environ['PI_CODING_AGENT_DIR']);agent.mkdir(parents=True,exist_ok=True)
(agent/'models.json').write_text(json.dumps(config))
(root/'runs/model-id.txt').write_text(model)
