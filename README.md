# dlite-sketches

A repo I use to iterate on the API of dlite by exploring lots of use cases

1. Create a `mapbox-token.js` file that simply exports a mapbox token as a string.
2. Run `npm i && npm start` to run the most recent demo



------------

### To do
 - [ ] Add `data/` to this repo
 - [ ] Try pulling out features into common libraries:
      - [ ] spring-based camera
      - [ ] physics-based simulation with transform-feedback (buffer rotating, etc)
      - [ ] arc-rendering / path-rendering

 - [ ] consider using deck's map controller instead of mapbox because mapbox has such a lag it causes the two canvas to go out of sync
 - [ ] figure out where `altitude` comes from in web-mercator-projection stuff (from Tarek: it's always 1.5x the screenheight?)
 - [ ] make camera uniforms a uniform block?
 - [ ] try rendering to framebuffer
 - [ ] make mapbox optional (show no map)
 - [ ] return project/unproject fns
 - [ ] create/manage vertexArrayObject/attributes for user?
 - [ ] experiment with exporting layers
 - [ ] create default fragment shader for transform feedback
 - [ ] create defaults to run on every call to make sure draw call state doesn't bleed into each other