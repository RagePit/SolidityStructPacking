(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
window.packer = require('bin-packer')

},{"bin-packer":3}],2:[function(require,module,exports){
'use strict'

const utils = require('./util/utils')
const fitAlgos = require('./fit-algos')
const bounds = require('./bounds')

module.exports = {
  binCompletion,
}

class CompletionNode {
  constructor(bin, size, depth, parent, parentWaste, tail, tailSum, capacity) {
    this.bin = bin
    this.depth = depth
    this.parent = parent
    this.accumulatedWaste = parentWaste + capacity - size
    this.tail = tail
    this.tailSum = tailSum
    this.capacity = capacity
  }

  completionChildFrom(feasibleSet) {
    const childBin = []
    const childTail = []
    for (let i = 0; i < feasibleSet.tailStartIndex; ++i) {
      if (feasibleSet.includedIndexes[i] !== undefined) {
        childBin.push(feasibleSet.array[i])
      } else {
        childTail.push(feasibleSet.array[i])
      }
    }
    return new CompletionNode(
        childBin,
        feasibleSet.includedSum,
        this.depth + 1,
        this,
        this.accumulatedWaste,
        childTail.concat(feasibleSet.array.slice(
            feasibleSet.tailStartIndex,
            feasibleSet.array.length)),
        feasibleSet.tailSum,
        this.capacity)
  }

  /** Walks up the tree, assembling itself and its parents into an array. */
  assemblePacking() {
    const packing = []
    let node = this
    while (node.parent !== null) {
        packing.push(node.bin)
        node = node.parent
    }
    return packing.reverse()
  }
}

class FeasibleSet {
  /**
   * @param {*} array Never modified
   * @param {*} includedIndexes Sparse array: value set at included indexes.
   * @param {*} includedSum 
   * @param {*} numIncludedIndexes Number of values set in includedIndexes
   * @param {*} tailStartIndex 
   * @param {*} tailSum 
   */
  constructor(
      array,
      includedIndexes,
      includedSum,
      numIncludedIndexes,
      tailStartIndex,
      tailSum) {
    this.array = array
    this.includedIndexes = includedIndexes
    this.includedSum = includedSum
    this.numIncludedIndexes = numIncludedIndexes
    this.tailStartIndex = tailStartIndex
    this.tailSum = tailSum
  }

  /* private */
  // May produce a non-feasible FeasibleSet (size larger than capacity) if includeTailStart === true.
  makeChildIncluding(sizeOf, nextIncludedIndex) {
    if (nextIncludedIndex < this.tailStartIndex ||
      this.array.length <= nextIncludedIndex) {
      throw new Error('Can only include an element from the tail when creating '+
          ' a new child')
    }
    const childIncludeIndexes = this.includedIndexes.slice()
    childIncludeIndexes[nextIncludedIndex] = nextIncludedIndex
    const elementSize = sizeOf(this.array[nextIncludedIndex])
    return new FeasibleSet(
      this.array,
      childIncludeIndexes,
      this.includedSum + elementSize,
      this.numIncludedIndexes + 1,
      nextIncludedIndex + 1,
      this.tailSum - elementSize)
  }

  makeChildNotIncluding(nextTailStartIndex) {
    if (nextTailStartIndex < this.tailStartIndex ||
        this.array.length < nextTailStartIndex) {
      // May equal tailStartIndex when the tail has been exhausted.
      throw new Error('Can not advance the tail past its length')
    }
    return new FeasibleSet(
      this.array,
      this.includedIndexes.slice(),
      this.includedSum,
      this.numIncludedIndexes,
      nextTailStartIndex,
      this.tailSum)
  }

  /**
   * Returns the next pair of children with an included and an excluded element.
   * Children that don't include an element are only useful in generating
   * later children that do include elements. So instead of recursing over a 
   * tree descending exclusively to the right, just cut strait to the next pair
   * where there is a choice between including and excluding a given element.
   * Any elements in the current tail up until that element will be excluded
   * from both children. If the tail is exhausted without finding an element
   * that can be included, then returns a single right child with the same
   * included elements as this, but with an empty tail.
   */
  makeFeasibleChildren(sizeOf, capacity) {
    const children = []
    let index = this.tailStartIndex
    while (index < this.array.length) {
      const elementSize = sizeOf(this.array[index])
      if (this.includedSum + elementSize <= capacity) {
        children.push(this.makeChildIncluding(sizeOf, index))
        break
      }
      ++index
    }
    // If the final element of the tail allows for a pair, then don't return the
    // exluded child. That completion can't be as good as the one including the
    // final element since there are no more elements to add.
    if (index >= this.array.length - 1) {
      if (children.length === 0) {
        // Got to the end of the array without being able to add another item.
        children.push(this.makeChildNotIncluding(this.array.length))
      }
      // Else added the final element of the tail. Don't add unincluded child.
    } else {
      // Added some non-final element.
      children.push(this.makeChildNotIncluding(index + 1))
    }
    return children
  }
}

class SolutionState {
  constructor(lowerBound, totalSize, capacity, bestSolution) {
    this.lowerBound = lowerBound    // const
    this.totalSize = totalSize      // const
    this.capacity = capacity        // const
    this.bestSolution = bestSolution
    this.maxWaste = this.getMaxWaste()
  }

  get bestLength() {
    return this.bestSolution.length
  }

  updateBestSolution(newBestSolution) {
    this.bestSolution = newBestSolution
    this.maxWaste = this.getMaxWaste()
  }

  /* private */
  getMaxWaste() {
    return (this.bestLength - 1) * this.capacity - this.totalSize
  }

  minCompletionSum(accumulatedWaste) {
    return this.capacity - (this.maxWaste - accumulatedWaste)
  }
}

function binCompletion(obj, sizeOf, capacity) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
  const descending = utils.sortDescending(array, sizeOf)
  const lowerBound = bounds.lowerBound2Sorted(descending.slice().reverse(), sizeOf, capacity)
  const bestSolution = fitAlgos.bestFitDecreasingSorted(descending, sizeOf, capacity)
  if (lowerBound === bestSolution.length) {
    return {
      'bins': bestSolution,
      'oversized': oversized,
    }
  } else {
    const totalSize = utils.sum(descending, sizeOf)
    const solutionState = new SolutionState(lowerBound, totalSize, capacity, bestSolution)
    const lowerBoundSolution = nextCompletionLevel(
              new CompletionNode([], capacity, 0, null, 0, descending, totalSize, capacity),
              solutionState,
              sizeOf)
    return {
      'bins': lowerBoundSolution || solutionState.bestSolution,
      'oversized': oversized,
    }
  }
}

/**
 * @param {CompletionNode} completionNode 
 * @param {SolutionState} solutionState 
 * @returns {null|array<array<object>>}
 */
function nextCompletionLevel(completionNode, solutionState, sizeOf) {
  const nextDepth = completionNode.depth + 1
  const feasibleSets = generateFeasibleSets(
      completionNode,
      solutionState,
      sizeOf)
  for (const feasibleSet of feasibleSets) {
    if (feasibleSet.numIncludedIndexes === feasibleSet.array.length) {
      // All elements have been binned.
      if (nextDepth === solutionState.lowerBound) {
        // Unbeatable solution.
        return completionNode.completionChildFrom(feasibleSet).assemblePacking()
      } else {
        // Store the new best solution. Will only have recursed to here if the
        // bin chain was shorter than the previous best.
        solutionState.updateBestSolution(
            completionNode.completionChildFrom(feasibleSet).assemblePacking())
      }
    } else {
      // Haven't used up all the elements yet. So recurse if, with one more bin, 
      // this chain will still be shorter than the current best solution.
      if (nextDepth + 1 < solutionState.bestLength) {
        const lowerBoundSolution = nextCompletionLevel(
            completionNode.completionChildFrom(feasibleSet),
            solutionState,
            sizeOf)
        if (lowerBoundSolution !== null) {
          // Forward the solution up the stack. No need to continue.
          return lowerBoundSolution
        }
      }
    }
  }
  // The best solution found so far has been stored in solutionState.
  return null
}

/**
 * @param {CompletionNode} completionNode 
 * @param {SolutionState} solutionState 
 * @returns {array<FeasibleSet>}
 */
function generateFeasibleSets(completionNode, solutionState, sizeOf) {
  // Individual elements are all assumed smaller than capacity, so no need to
  // check for a bin containing a single element.
  const largestElementSize = sizeOf(completionNode.tail[0])
  return recurseFeasibleSets(
      new FeasibleSet(
          completionNode.tail,
          [0,], // Always include the largest element.
          largestElementSize,
          1,
          1,
          completionNode.tailSum - largestElementSize),
      sizeOf,
      solutionState.capacity,
      solutionState.minCompletionSum(completionNode.accumulatedWaste))
}

/**
 * Generates all feasible sets containing this set's elements and any smaller
 * elements. Assumes {@link feasibleSet}'s size is less than capacity (i.e. is
 * truly a feasible set).
 * @param {FeasibleSet} feasibleSet 
 * @param {number} capacity 
 * @param {number} minCompletionSum 
 * @returns {array<FeasibleSet>}
 */
function recurseFeasibleSets(feasibleSet, sizeOf, capacity, minCompletionSum) {
  if (feasibleSet.includedSum === capacity) {
    // Already full.
    return [feasibleSet,]
  } else if (feasibleSet.tailStartIndex >= feasibleSet.array.length) {
    // Leaf node, check if it's too wasteful to be a completion.
    if (feasibleSet.includedSum >= minCompletionSum) {
      return [feasibleSet,]
    } else {
      return []
    }
  } else if (feasibleSet.includedSum + feasibleSet.tailSum >= minCompletionSum) {
    // Return completions from our descendents.
    const children = feasibleSet.makeFeasibleChildren(sizeOf, capacity)
    const descendentSets = recurseFeasibleSets(
        children[0],
        sizeOf,
        capacity,
        minCompletionSum)
    if (children.length < 2) {
      return descendentSets
    } else {
      return descendentSets.concat(recurseFeasibleSets(
          children[1],
          sizeOf,
          capacity,
          minCompletionSum))
    }
  } else {
    // The tail is too small to form any completions from here.
    return []
  }
}

},{"./bounds":4,"./fit-algos":5,"./util/utils":6}],3:[function(require,module,exports){
'use strict'

const fitAlgos = require('./fit-algos')
const binCompletion = require('./bin-completion')
const bounds = require('./bounds')

exports.nextFit = fitAlgos.nextFit
exports.firstFit = fitAlgos.firstFit
exports.firstFitDecreasing = fitAlgos.firstFitDecreasing
exports.bestFitDecreasing = fitAlgos.bestFitDecreasing
exports.binCompletion = binCompletion.binCompletion
exports.lowerBound1 = bounds.lowerBound1
exports.lowerBound2 = bounds.lowerBound2

},{"./bin-completion":2,"./bounds":4,"./fit-algos":5}],4:[function(require,module,exports){
'use strict'

const utils = require('./util/utils')

module.exports = {
  lowerBound1,
  lowerBound2,
  lowerBound2Sorted,
}

/**
 * A simple-to-compute lower bound on the number of bins required by an optimal
 * solution. Computes the nubmer of bins required if elements' sizes could be
 * split across bins to fill each completely before opening a new one.
 * @param {*} obj 
 * @param {*} sizeOf 
 * @param {*} capacity 
 * @returns An object with two keys: 'bound' giving the lower bound and
 *          'oversized' giving the number of oversized items.
 */
function lowerBound1(obj, sizeOf, capacity) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
  return {
    'bound': Math.ceil(utils.sum(array, sizeOf) / capacity),
    'oversized': oversized.length,
  }
}

/**
 * Martello and Toth's L2 lower bound on the number of bins required by an
 * optimal solution. Combines the methodology of the L1 lower bound with the
 * addition of a 'waste' component for each bin that can be shown not to be
 * fully fillable.
 * @param {*} obj 
 * @param {*} sizeOf 
 * @param {*} capacity 
 * @returns An object with two keys: 'bound' giving the lower bound and
 *          'oversized' giving the number of oversized items.
 */
function lowerBound2(obj, sizeOf, capacity) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
  return {
    'bound': lowerBound2Sorted(utils.sortAscending(array, sizeOf), sizeOf, capacity),
    'oversized': oversized.length,
  }
}

/**
 * Assumes {@link sortedArray} contains no oversized items and is sorted ascending.
 * Consumes {@link sortedArray}.
 * @param {*} sortedArray 
 * @param {*} sizeOf 
 * @param {*} capacity 
 */
function lowerBound2Sorted(sortedArray, sizeOf, capacity) {
  // Calculates the total as it visits each element.
  let waste = 0
      , carry = 0
      , elementTotal = 0
  const constSizeOf = sizeOf // const for linter.
  while (sortedArray.length > 0) {
    const largestSize = sizeOf(sortedArray.pop())
    elementTotal += largestSize
    const remainder = capacity - largestSize
    const firstLargerThanRemainder = sortedArray.findIndex(function (element) {
      return constSizeOf(element) > remainder
    })
    const smallerCount = firstLargerThanRemainder === -1 ?
        sortedArray.length :
        firstLargerThanRemainder // Not an off-by-one error :)
    const smallerTotal = smallerCount > 0 ?
        utils.sum(sortedArray.splice(0, smallerCount), sizeOf) :
        0
    elementTotal += smallerTotal
    carry += smallerTotal
    if (remainder < carry) {
      carry -= remainder
    } else if (remainder > carry) {
      waste += remainder - carry
      carry = 0
    }
  }
  return Math.ceil((waste + elementTotal) / capacity)
}

},{"./util/utils":6}],5:[function(require,module,exports){
'use strict'

const utils = require('./util/utils')

module.exports = {
  nextFit,
  firstFit,
  firstFitDecreasing,
  bestFitDecreasing,
  bestFitDecreasingSorted,
}

function nextFit(obj, sizeOf, capacity) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
      , bins = []
  let currentBinSize = capacity + 1 // Start out with an imaginary bin that's full.
      , blockNum = -1

  for (const value of array) {
    const size = sizeOf(value)
    currentBinSize += size
    if (currentBinSize > capacity) {
      ++blockNum
      bins[blockNum] = []

      currentBinSize = size
    }
    bins[blockNum].push(value)
  }
  return {bins: bins, oversized: oversized,}
}

function firstFit(obj, sizeOf, capacity) {
  return firstFitArray(obj, sizeOf, capacity, false)
}

function firstFitDecreasing(obj, sizeOf, capacity) {
  return firstFitArray(obj, sizeOf, capacity, true)
}

function firstFitArray(obj, sizeOf, capacity, presort) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
      , bins = []
      , remaining = []

  if (presort) {
    utils.sortDescending(array, sizeOf)
  }

  for (const value of array) {
    const size = sizeOf(value)
    let createNewBin = true
    for (const i in bins) {
      if (size <= remaining[i]) {
        bins[i].push(value)
        remaining[i] -= size
        createNewBin = false
        break
      }
    }
    if (createNewBin) {
      bins[bins.length] = []
      bins[bins.length - 1].push(value)
      remaining[bins.length - 1] = capacity - size
    }
  }
  return {'bins': bins, 'oversized': oversized,}
}

class SizedBin {
  constructor() {
    this.bin = []
    this.size = 0
  }
  
  static extractBins(sizedBins) {
    return sizedBins.map(sizedBin => sizedBin.bin)
  }
}

function bestFitDecreasing(obj, sizeOf, capacity) {
  const {array: array, oversized: oversized} = utils.prepareValues(obj, sizeOf, capacity)
  return {
    'bins': bestFitDecreasingSorted(utils.sortDescending(array, sizeOf), sizeOf, capacity),
    'oversized': oversized,
  }
}

/**
 * Assumes {@link sorted} contains no oversized items and is sorted descending.
 * Does not modify {@link sorted}.
 * @param {*} sorted 
 * @param {*} sizeOf 
 * @param {*} capacity 
 */
function bestFitDecreasingSorted(sorted, sizeOf, capacity) {
  const itemLeq = (item, _, bin) => sizeOf(item) <= capacity - bin.size
      , itemInsert = (item, sizedBins, i) => {
        if (i >= sizedBins.length) { // Will never be strictly >.
          sizedBins.push(new SizedBin())
        }
        sizedBins[i].size += sizeOf(item)
        sizedBins[i].bin.push(item)
      }
      , binMoreFull = (currentIndex, sizedBins, bin) => sizedBins[currentIndex].size >= bin.size // Sort it earlier if it's larger!
      , binResort = (currentIndex, sizedBins, i) => {
        if (i === currentIndex) {
          return
        }
        if (i > currentIndex) {
          throw new Error(`Algorithm error: newIndex ${i} > currentIndex ${currentIndex}`)
        }
        const binToMove = sizedBins[currentIndex]
        sizedBins.copyWithin(i + 1, i, currentIndex)
        sizedBins[i] = binToMove
      }

  const bins = []
  for (const value of sorted) {
    // Insert item into (potentially new) bin
    const binIndex = utils.binaryApply(bins, value, itemLeq, itemInsert)
    // Move updated bin to preserve sort
    utils.binaryApply(bins, binIndex, binMoreFull, binResort)
  }
  return SizedBin.extractBins(bins)
}

},{"./util/utils":6}],6:[function(require,module,exports){
'use strict'

module.exports = {
  prepareValues,
  toArray,
  sortDescending,
  sortAscending,
  sum,
  binaryApply,
}

/**
 * Returns an object containing the input as an array and any oversized items moved to a second array.
 * Throws if {@link sizeOf} does not return a number for any value of {@link obj}.
 */
function prepareValues(obj, sizeOf, capacity) {
  if (validateNumber(capacity, 'capacity') <= 0) {
    throw new Error('Capacity must be a positive number')
  }
  const array = toArray(obj)
      , oversized = []
      , oversizedIndexes = []
  for (const [index, element] of array.entries()) {
    const size = sizeOf(element)
    validateNumber(size, index)
    if (size > capacity) {
      oversized.push(element)
      oversizedIndexes.push(index)
    }
  }
  for (const index of oversizedIndexes.reverse()) {
    array.splice(index, 1)
  }
  return {array: array, oversized: oversized,}
}

function toArray(obj) {
  if (Array.isArray(obj)) {
    return obj
  } else {
    return Array.from(toIterable(obj))
  }
}

/**
 * Converts the argument to an interable if it is not one already.
 * In particular, if it is a non-iterable object, returns an array of the object's own innumerable property values.
 * @param {iterable|object} obj
 */
function toIterable(obj) {
  if (obj !== null) {
    if (typeof obj[Symbol.iterator] === 'function') {
      return obj
    } else if (typeof obj === 'object') {
      return Object.values(obj)
    }
  }
  throw new Error('Must be either iterable or a non-function object')
}

/**
 * Throws if {@link num} is not a {@link number}.
 * @param {*} num 
 * @param {*} context 
 * @returns {number}    The input {@link num} for chaining.
 */
function validateNumber(num, context) {
  if (num === null || num === undefined || typeof num !== 'number') {
    throw new Error(`expected a number for ${context}`)
  } else {
    return num
  }
}

function sortDescending(array, sizeOf) {
  return array.sort((left, right) => sizeOf(right) - sizeOf(left))
}

function sortAscending(array, sizeOf) {
  return array.sort((left, right) => sizeOf(left) - sizeOf(right))
}

function sum(array, sizeOf) {
  return array.reduce((acc, cur) => acc += sizeOf(cur), 0)
}

/**
 * Performs a recursive binary search to find the index at which to apply {@param operation}. The {@param array} is
 * assumed to be sorted according to {@param leq} in relation to objects of the same type as {@param item}, a property
 * which {@param operation} is required to preserve.
 * @param {array} array         A sorted array
 * @param {*} item              The item to be 'inserted' into the array. May not be of the same type as the array
 *                              elements. E.g. each array element may be an object or array into which the item 
 *                              can be inserted.
 * @param {function} leq        A function: (item, array, arrayElement) => whether item is '<=' arrayElement.
 * @param {function} operation  A function: (item, array, i) => undefined. i is index in array where item is to be applied.
 *                              Expected to modify array in-place.
 * @returns undefined           Modifies {@param array}.
 */
function binaryApply(array, item, leq, operation) {
  return binaryApplyRecursive(array, 0, array.length - 1, item, leq, operation)
}

function binaryApplyRecursive(array, left, right, item, leq, operation) {
  if (left > right) { // When left === right in the previous round due to use of floor in mid calculation
    if (left > right + 1) {
      throw new Error(`Algorithm error: left ${left} > right ${right} + 1`)
    }
    const index = left
    operation(item, array, index)
    return index
  }
  if (left === right) {
    const index = leq(item, array, array[left]) ? left : left + 1
    operation(item, array, index)
    return index
  }
  const mid = Math.floor((left + right) / 2)
  if (leq(item, array, array[mid])) {
    return binaryApplyRecursive(array, left, mid - 1, item, leq, operation)
  } else {
    return binaryApplyRecursive(array, mid + 1, right, item, leq, operation)
  }
}

},{}]},{},[1]);
