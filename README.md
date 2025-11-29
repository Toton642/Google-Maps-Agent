# Google-Maps-Agent

https://simulationagentgmaps.netlify.app/

Steps to use:
1. Click and open the above link.
2. Then, check the details below for start location to destination to choose from drop down:

Start Location -> Destinations (as applicable, see blue_agent_paths_unique.csv for more):

a. city hall -> staten island
b. barnard college -> new york university
.
.
.
so on..

3. Click toggle street view to check how it navigates, check the CoT(main).csv for getting the chain of thoughts, then click on conversation and click start agent conversation to start.
4. Return to map as required.

Powered by Gemini API and Google Cloud TTS and made by Soumyadeep Nag on LLMs as Autonomous Agents in navigable abilities.

If the link doesnot work.. please create a local isolated folder in your system, then upload index.html and main.js and a subfolder named "models" .. in the subfolder upload "agent1.glb", "agent2.glb".

Then open VSCode or similar, then run the main.js server using node main.js in the terminal of the current directory (isolated folder) and open live server through index.html. 

Thank you.
