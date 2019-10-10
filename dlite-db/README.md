# dlite-db

The idea behind `dlite-db` is a proposal for how the pipeline from tabular data -> rendered visualization could work as a chainable series of transformations.

The general outline for the pipeline is as follows:

1. Transform tabular data to binary representation in buffer
2. Query data
3. Transform query output into render values
4. Transition render values (optional)
5. Render visualization with render values

Taking each separately:

1. Transform tabular data to binary representation in buffer

This goal of this step is to transform denormalized tabular data (e.g. a CSV) into a format that can be processed on the GPU. This could be as simple as a Node script which takes in (1) a tabular data source (e.g. CSV) and (2) some transformation definitions to be used to map values from the data source input to new columns in the binary output (more on this below). The output of the script would be (1) the binary data (essentially an interleaved buffer, ready to be loaded to a GPU buffer) and (2) a schema describing the datatype of each column, along with some simple stats (counts, sum, mean, quantiles, unique values, etc). This schema can be used by the following query step to set up a transform feedback shader source with the appropriate uniforms and functions to support filtering and aggregating in a render pass.

[give example here]

2. Query data

3. Transform query output into render values

4. Transition render values (optional)

5. Render visualization with render values
