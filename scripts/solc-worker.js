importScripts('./soljson-v0.8.9+commit.e5eed63a.js')
importScripts('./solcbundle.js')

function compile(contract) {
    var input = {
        language: 'Solidity',
        sources: {
            'test.sol': {
                content: contract
            }
        },
        settings: {
            outputSelection: {
            '*': {
                '*': ['*']
            }
            }
        }
    };
    
    var output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.contracts) return output.contracts['test.sol']['C']
    else return { "error": output.errors }
}   


onmessage = function(msg) {
    const compiled = compile(msg.data)
    postMessage(compiled)
}