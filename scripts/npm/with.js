const Parser = require('./with/parser.js');
const Storage = require('./with/storage.js');

// avoid running the code again if this one gets required
if (require.main !== module) {
    // easy read
    module.exports = (data, source) => {
        return (new Storage(source)).read(data);
    };

    return false;
}

const parser = new Parser();
const storage = new Storage();

// Add custom expressions here. Order matters!
// ...

// default expressions
parser.addNamespaceExpression();
parser.addKeyValueExpression();
parser.addOptionExpression();

// parse
parser.parse();

// save
storage.save(parser.all());
