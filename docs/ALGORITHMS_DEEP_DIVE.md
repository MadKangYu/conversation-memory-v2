# InstantCompressor 알고리즘 기술 백서

**저자**: Manus AI
**날짜**: 2026년 1월 9일
**버전**: 1.0

## 1. 서론

Conversation Memory V5의 핵심인 `InstantCompressor`는 LLM 호출 없이 10M 토큰을 10초 이내에 처리하기 위해 설계되었습니다. 이는 세 가지 핵심적인 정보 검색 및 데이터 마이닝 알고리즘의 조합을 통해 가능합니다:

1.  **TF-IDF (Term Frequency-Inverse Document Frequency)**: 핵심 키워드 추출
2.  **TextRank**: 핵심 문장 추출
3.  **SimHash**: 중복 청크 제거

본 문서는 각 알고리즘의 이론적 배경, 수학적 원리, 그리고 `InstantCompressor` 내에서의 실제 구현 방식을 상세히 설명합니다.

---

## 2. TF-IDF: 핵심 키워드 추출

### 2.1. 개념

TF-IDF는 특정 문서 내에서 한 단어가 얼마나 중요한지를 나타내는 통계적 수치입니다. 단순히 단어의 빈도수(TF)만 보는 것이 아니라, 그 단어가 전체 문서 집합(Corpus)에서 얼마나 희소한지(IDF)를 함께 고려합니다. [1]

> **직관적 이해**: "코딩"이라는 단어가 한 문서에 100번 등장해도, 모든 문서에 "코딩"이 등장한다면 중요도는 낮습니다. 반면, "Zustand"라는 단어가 한 문서에 5번만 등장해도, 다른 문서에는 거의 등장하지 않는다면 중요도는 매우 높습니다.

### 2.2. 수학적 원리

TF-IDF 점수는 TF와 IDF의 곱으로 계산됩니다.

`TF-IDF(t, d, D) = TF(t, d) * IDF(t, D)`

-   `t`: 단어 (term)
-   `d`: 특정 문서 (document)
-   `D`: 전체 문서 집합 (Corpus)

#### Term Frequency (TF)

문서 `d`에서 단어 `t`의 등장 빈도입니다. 문서 길이에 따른 편향을 줄이기 위해 정규화합니다.

`TF(t, d) = (문서 d 내 단어 t의 등장 횟수) / (문서 d의 전체 단어 수)`

#### Inverse Document Frequency (IDF)

단어 `t`가 전체 문서 집합 `D`에서 얼마나 희소한지를 나타냅니다. 분모에 1을 더하는 것은 특정 단어가 모든 문서에 등장하여 분모가 0이 되는 것을 방지하기 위함입니다 (Laplace Smoothing). [2]

`IDF(t, D) = log( (전체 문서 수) / (단어 t를 포함한 문서 수 + 1) )`

### 2.3. InstantCompressor 구현

`InstantCompressor`는 500토큰 청크를 하나의 문서(`d`)로, 전체 대화를 문서 집합(`D`)으로 간주합니다. 각 청크에서 TF-IDF 점수가 가장 높은 상위 20개 키워드를 추출하여 해당 청크의 핵심 주제로 삼습니다.

```typescript
// src/core/instant-compressor.ts (의사 코드)
function getTopKeywords(chunk: string[], corpus: string[][]): string[] {
  const scores: { [term: string]: number } = {};
  const uniqueTerms = [...new Set(chunk)];

  for (const term of uniqueTerms) {
    const tf = chunk.filter(w => w === term).length / chunk.length;
    const docCount = corpus.filter(doc => doc.includes(term)).length;
    const idf = Math.log(corpus.length / (docCount + 1));
    scores[term] = tf * idf;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(entry => entry[0]);
}
```

---

## 3. TextRank: 핵심 문장 추출

### 3.1. 개념

TextRank는 Google의 PageRank 알고리즘을 텍스트 요약에 적용한 그래프 기반 알고리즘입니다. [3] 문장들을 그래프의 노드(Node)로, 문장 간의 유사도를 엣지(Edge)의 가중치로 설정합니다. 그 후, PageRank 알고리즘을 실행하여 "다른 중요한 문장들로부터 많은 추천을 받은 문장"을 핵심 문장으로 간주합니다.

### 3.2. 작동 방식

1.  **문장 분리**: 텍스트를 문장 단위로 분리합니다.
2.  **유사도 행렬 생성**: 모든 문장 쌍(pair)에 대해 유사도를 계산하여 행렬을 만듭니다. 유사도는 보통 코사인 유사도(Cosine Similarity)나 자카드 유사도(Jaccard Similarity)를 사용합니다.
3.  **그래프 생성**: 문장을 노드로, 유사도를 가중치로 갖는 그래프를 생성합니다.
4.  **PageRank 실행**: 그래프 위에서 PageRank 알고리즘을 반복적으로 실행하여 각 문장의 랭킹 점수를 계산합니다.
5.  **핵심 문장 추출**: 랭킹 점수가 높은 순서대로 상위 N개의 문장을 추출합니다.

### 3.3. InstantCompressor 구현

`InstantCompressor`는 각 청크 내에서 TextRank를 실행하여 가장 중요한 상위 3개의 문장을 추출합니다. 이는 청크의 전체적인 맥락을 보존하는 역할을 합니다.

```typescript
// src/core/instant-compressor.ts (의사 코드)
function getTopSentences(sentences: string[]): string[] {
  // 1. 문장별 벡터 생성 (e.g., TF-IDF 기반)
  const sentenceVectors = sentences.map(s => createVector(s));

  // 2. 유사도 행렬 생성
  const similarityMatrix = buildSimilarityMatrix(sentenceVectors);

  // 3. PageRank 알고리즘 실행
  let scores = new Array(sentences.length).fill(1);
  for (let i = 0; i < 20; i++) { // 20회 반복
    scores = updateScores(scores, similarityMatrix);
  }

  // 4. 점수 기반 정렬 및 상위 3개 추출
  return sentences
    .map((s, i) => ({ sentence: s, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.sentence);
}
```

---

## 4. SimHash: 중복 청크 제거

### 4.1. 개념

SimHash는 문서의 유사도를 매우 빠르게 비교하기 위한 지역성 민감 해싱(Locality-Sensitive Hashing, LSH)의 한 종류입니다. [4] SimHash는 문서 전체를 하나의 64비트 또는 128비트 해시 "지문(fingerprint)"으로 변환합니다. 이때, **원본 문서가 약간만 달라도 생성된 해시는 약간만 다릅니다.**

이 특성을 이용하여 두 해시 간의 해밍 거리(Hamming distance, 서로 다른 비트의 개수)를 계산하면 원본 문서의 유사도를 근사적으로 파악할 수 있습니다.

> **장점**: 수십만 개의 문서를 비교할 때, 모든 쌍을 비교하는 것은 O(n²)의 시간이 걸립니다. SimHash를 사용하면 해시 테이블을 통해 O(n)에 가까운 시간 복잡도로 유사한 문서를 찾을 수 있습니다.

### 4.2. 작동 방식

1.  **가중치 부여**: 문서의 각 단어에 가중치를 부여합니다 (예: TF-IDF 점수).
2.  **해싱**: 각 단어를 전통적인 해시 함수(예: MD5, SHA-1)를 사용하여 64비트 해시로 변환합니다.
3.  **벡터화**: 64비트 해시를 64차원 벡터로 변환합니다. 각 비트가 1이면 `+가중치`, 0이면 `-가중치`를 벡터의 해당 차원에 더합니다.
4.  **합산**: 모든 단어의 벡터를 합산하여 하나의 64차원 벡터를 만듭니다.
5.  **최종 해시 생성**: 합산된 벡터의 각 차원 값이 양수이면 1, 음수이면 0으로 변환하여 최종 64비트 SimHash 지문을 생성합니다.

### 4.3. InstantCompressor 구현

`InstantCompressor`는 처리된 모든 청크에 대해 SimHash를 계산합니다. 새로운 청크가 들어오면, 기존 해시들과의 해밍 거리를 계산합니다. 해밍 거리가 3 이하인 청크는 중복으로 간주하여 폐기합니다. 이는 대화에서 반복되는 내용(예: "알겠습니다", "네, 알겠습니다")을 효과적으로 제거합니다.

```typescript
// src/core/instant-compressor.ts (의사 코드)
const processedHashes: bigint[] = [];

function isDuplicate(chunkText: string): boolean {
  const newHash = calculateSimHash(chunkText);

  for (const existingHash of processedHashes) {
    const distance = hammingDistance(newHash, existingHash);
    if (distance <= 3) {
      return true; // 중복
    }
  }

  processedHashes.push(newHash);
  return false;
}

function hammingDistance(hash1: bigint, hash2: bigint): number {
  let xor = hash1 ^ hash2;
  let distance = 0;
  while (xor > 0n) {
    xor &= (xor - 1n); // 가장 오른쪽 1비트 제거
    distance++;
  }
  return distance;
}
```

---

## 5. 결론

`InstantCompressor`는 TF-IDF, TextRank, SimHash라는 세 가지 강력하고 계산적으로 효율적인 알고리즘을 결합하여 LLM 없이도 대규모 텍스트를 실시간으로 압축합니다. 이 3단계 파이프라인은 정보의 핵심을 보존하면서 중복을 제거하여, 후속 `JabEngine`이 최소한의 정보로 최대의 효과를 낼 수 있는 기반을 마련합니다.

## 6. 참고 문헌

[1] Jones, K. S. (2004). A statistical interpretation of term specificity and its application in retrieval. *Journal of documentation*, 60(5), 493-502.

[2] Manning, C. D., Raghavan, P., & Schütze, H. (2008). *Introduction to Information Retrieval*. Cambridge University Press.

[3] Mihalcea, R., & Tarau, P. (2004). TextRank: Bringing order into texts. In *Proceedings of the 2004 conference on empirical methods in natural language processing*.

[4] Manku, G. S., Jain, A., & Das Sarma, A. (2007). Detecting near-duplicates for web crawling. In *Proceedings of the 16th international conference on World Wide Web*.
