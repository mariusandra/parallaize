This is a document describing an app to build, parallaize. in the next steps clean up this
file and convert it into a proper agentic todo that can be pointed to in the next steps.

parallaize is a full stack typescript app. it should be able to run it either on the server or
as an electron app. for now we only care about the server. all of this should run in a client server web app.

it's targeted towards servers with heaps of ram, like this one here with 48 cores/96 threads and 256g of ram
the goal of the app is to build a product using multiple parallel virtual desktops as possible
each desktop would essentially be running an ai agent. 

for starters, let's just figure out the "multiple virtual desktops" problem. the root of the app when you
open it is a grid of virtual environments that are running, plus an easy "+" button to create new ones.
it would show the current screenshot live of the app. you could click on them to zoom in and take control.
when zoomed out, there would be some controls around the app, like "clone", "kill", etc.

somewhere there's a page where you can configure environments. an environment is just a vm with a preconfigured
set of tools installed on it. should be a standard ubuntu desktop environment. to configure an environment
you start a vm and configure the system to a state that makes sense for you - install the required packages, start
the required programs in the right folders, etc. you then save that as a new environment. if you run a saved 
environment the old one stays in place, a clone is made and run, and you can resnapshot that.
any running vm can be snapshotted into an environment (or can override the one that's open if you choose, 
though even then save a snapshot history so we can always revert)

choose the file systems and tech that'll do the job. evaluate "incus" for the job, put caddy in front
of everything. apache guacamole seems to be a decent server.

i'd also be able to run periodic scripts on command in the vms and to modify their file systems from the outside
if possible. though that's not a hard requirement now.

the ultimate goal is to be coding with llms on multiple projects at a time, each in their fully isolated
vm, with a neat interface to easily toggle between them. it should be running on this machine. 

keep doing as much work as needed so that we have a proof of concept ready, and update this todo file as you go along.
let the user enter the ram, cpu and disk limits per environment. those should be reconfigurable on a vm basis as needed

