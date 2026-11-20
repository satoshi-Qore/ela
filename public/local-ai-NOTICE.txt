# ELA intent v1 — model provenance and limitations

This is a real static-embedding intent classifier, not a generative LLM. Existing 7H-5 lab variant `v16k-train-int8`, without retraining or threshold changes.

- Teacher: [minishlab/potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M) revision `73908c3438cf03b6a01bcb9611d62b23d0726f08` (MIT), distilled from BAAI/bge-m3 (MIT). Tokenizer: bge-m3/XLM-R Unigram (MIT).
- Latin vocabulary pruned to 16,000 entries; 256-dimensional embeddings, per-row int8 quantization. Mean pooling excluding UNK, L2 normalization, trained six-label softmax head. Temperature 1.5 was folded into the existing weights.
- Existing head trained on 720 lab commands; choices made using 180 validation commands. Neither the 307 regression set nor final-blind labels were training inputs. No training is performed by this integration.
- The serialized historical config contains experimental thresholds; the runtime **does not use them**. ELA's unchanged decision thresholds (0.75 confidence / 0.20 margin) apply.
- Teacher training data: Tokenlearn C4 multilingual bge-m3 dataset, derived from AllenAI C4 (ODC-BY). The Tokenlearn dataset card does not declare a separate license. This provenance limitation is retained; MIT model metadata is not a guarantee about all upstream dataset rights.
- Source file hashes, packaged SHA-256 and exact bytes are in `ela-intent-v1.json`. `scripts/package-local-model.mjs <lab-variant-folder> --check` checks reproducibility without overwriting anything.
- Tokenizer implementation: @huggingface/tokenizers 0.2.0, Apache-2.0, no transitive dependencies. Its license ships in the installed package.

The model proposes only six labels; no RPC methods, parameters, keys, tools or conversation context are passed to it. Accuracy is limited. See the evaluation report; do not describe this classifier as general reasoning or a replacement for the safety gate.

## MIT license notice for derived model/tokenizer

Copyright (c) MinishLab and respective upstream contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
