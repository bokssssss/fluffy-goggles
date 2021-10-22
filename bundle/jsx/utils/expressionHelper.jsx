/*jslint vars: true , plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global $, bm_eventDispatcher, esprima, escodegen*/

var bm_expressionHelper = (function () {
    'use strict';
    var ob = {};
    var options = {
        tokens: true,
        range: true
    };
    var expressionStr;
    var pendingBodies = [], doneBodies = [];
    function spliceSlice(str, index, count, add) {
        return str.slice(0, index) + (add || "") + str.slice(index + count);
    }

    function addReturnStatement(expression) {
        var parsed = esprima.parse(expression, options);
        var body = parsed.body;
        var lastRange = body[body.length - 1].range;
        return spliceSlice(expression, lastRange[0], 0, 'var $bm_rt = ');
    }

    function includeUndeclaredVariables() {
        doneBodies.sort(function (a, b) {
            return parseInt(b.p, 10) - parseInt(a.p, 10);
        });
        var i, len = doneBodies.length;
        var declarationStr = '';
        for (i = 0; i < len; i += 1) {
            if (doneBodies[i].u.length) {
                declarationStr = 'var ' + doneBodies[i].u.join(',') + ';';
                expressionStr = spliceSlice(expressionStr, doneBodies[i].p, 0, declarationStr);
            }
        }
    }

    function exportNextBody() {
        if (pendingBodies.length === 0) {
            includeUndeclaredVariables();
        } else {
            var next = pendingBodies.shift();
            var preDeclared = [];
            preDeclared = preDeclared.concat(next.pre);
            preDeclared = preDeclared.concat(next.d);
            preDeclared = preDeclared.concat(next.u);
            findUndeclaredVariables(next.body, next.pos, preDeclared);
        }
    }

    function findUndeclaredVariables(body, pos, predeclared, declared, undeclared, isContinuation) {

        function addAssignment(expression) {
            var variableName;
            if (expression.left && expression.left.name) {
                variableName = expression.left.name;
                if(variableName === 'value'){
                    return;
                }
                var i = 0, len = declared.length;
                while (i < len) {
                    if (declared[i] === variableName) {
                        return;
                    }
                    i += 1;
                }
                i = 0;
                len = declared.length;
                while (i < len) {
                    if (undeclared[i] === variableName) {
                        return;
                    }
                    i += 1;
                }
                undeclared.push(variableName);
            }
        }

        function addSequenceExpressions(expressions) {
            var i, len = expressions.length;
            for (i = 0; i < len; i += 1) {
                if (expressions[i].type === 'AssignmentExpression') {
                    addAssignment(expressions[i]);
                }
            }
        }

        function addDeclaredVariable(variableName) {
            var i = 0, len = declared.length;
            while (i < len) {
                if (declared[i] === variableName) {
                    return;
                }
                i += 1;
            }
            declared.push(variableName);
        }

        function addIfStatement(statement){
            if(statement.consequent){
                if (statement.consequent.type === 'BlockStatement') {
                    findUndeclaredVariables(statement.consequent.body, 0, null, declared, undeclared, true);
                } else if (statement.consequent.type === 'ExpressionStatement') {
                    expression = statement.consequent.expression;
                    if (expression.type === 'AssignmentExpression') {
                        addAssignment(expression);
                    } else if (expression.type === 'SequenceExpression') {
                        addSequenceExpressions(expression.expressions);
                    }
                } else if (statement.consequent.type === 'ReturnStatement') {
                    //
                }
            }
            if (statement.alternate) {
                if (statement.alternate.type === 'IfStatement') {
                    addIfStatement(statement.alternate)
                } else if (statement.alternate.type === 'BlockStatement') {
                    findUndeclaredVariables(statement.alternate.body, 0, null, declared, undeclared, true);
                } else if (statement.alternate.type === 'ExpressionStatement') {
                    expression = statement.alternate.expression;
                    if (expression.type === 'AssignmentExpression') {
                        addAssignment(expression);
                    } else if (expression.type === 'SequenceExpression') {
                        addSequenceExpressions(expression.expressions);
                    }
                }
            }
        }

        function addTryStatement(statement){
            if (statement.block) {
                if (statement.block.type === 'BlockStatement') {
                    findUndeclaredVariables(statement.block.body, 0, null, declared, undeclared, true);
                }
            }
            if (statement.handler) {
                if (statement.handler.body.type === 'BlockStatement') {
                    findUndeclaredVariables(statement.handler.body.body, 0, null, declared, undeclared, true);
                }
            }
        }

        if (!declared) {
            declared = [];
        }
        if (!undeclared) {
            undeclared = [];
        }
        var i, len;
        if (predeclared) {
            len = predeclared.length;
            for (i = 0; i < len; i += 1) {
                declared.push(predeclared[i]);
            }
        }
        len = body.length;
        var j, jLen, expression, declarations;
        for (i = 0; i < len; i += 1) {
            if (body[i].type === 'VariableDeclaration') {
                declarations = body[i].declarations;
                jLen = declarations.length;
                for (j = 0; j < jLen; j += 1) {
                    if (declarations[j].type === 'VariableDeclarator') {
                        if (declarations[j].id && declarations[j].id.name) {
                            addDeclaredVariable(declarations[j].id.name);
                        }
                    }
                }
            } else if (body[i].type === 'ExpressionStatement') {
                expression = body[i].expression;
                if (expression.type === 'AssignmentExpression') {
                    addAssignment(expression);
                } else if (expression.type === 'SequenceExpression') {
                    addSequenceExpressions(expression.expressions);
                }
                //
            } else if (body[i].type === 'ForStatement') {
                if (body[i].init) {
                    if (body[i].init.type === 'SequenceExpression') {
                        addSequenceExpressions(body[i].init.expressions);
                    } else if (body[i].init.type === 'AssignmentExpression') {
                        addAssignment(body[i].init);
                    }
                }
                if (body[i].body) {
                    if (body[i].body.type === 'BlockStatement') {
                        findUndeclaredVariables(body[i].body.body, 0, null, declared, undeclared, true);
                    } else if (body[i].body.type === 'ExpressionStatement') {
                        expression = body[i].body.expression;
                        if (expression.type === 'AssignmentExpression') {
                            addAssignment(expression);
                        } else if (expression.type === 'SequenceExpression') {
                            addSequenceExpressions(expression.expressions);
                        }
                        //addAssignment(body[i].body);
                    }
                }
            } else if (body[i].type === 'IfStatement') {
                addIfStatement(body[i]);
            } else if (body[i].type === 'TryStatement') {
                addTryStatement(body[i]);
            } else if (body[i].type === 'FunctionDeclaration') {
                if (body[i].body && body[i].body.type === 'BlockStatement') {
                    var p = [];
                    if (body[i].params) {
                        jLen = body[i].params.length;
                        for (j = 0; j < jLen; j += 1) {
                            p.push(body[i].params[j].name);
                        }
                    }
                    pendingBodies.push({body: body[i].body.body, d: declared, u: undeclared, pre: p, pos: body[i].body.range[0] + 1});
                }
            }
        }
        if (!isContinuation) {
            doneBodies.push({u: undeclared, p: pos});
            exportNextBody();
        }
    }

    function searchUndeclaredVariables() {
        var parsed = esprima.parse(expressionStr, options);
        var body = parsed.body;
        pendingBodies.push({body: body, d: [], u: [], pre: [], pos: 0});
        exportNextBody();
    }


    function searchOperations(body) {
        var i, len = body.length;
        for (i = 0; i < len; i += 1) {
            if (body[i].type === 'ExpressionStatement') {
                handleExpressionStatement(body[i]);
            } else if (body[i].type === 'IfStatement') {
                handleIfStatement(body[i]);
            } else if (body[i].type === 'FunctionDeclaration') {
                handleFunctionDeclaration(body[i]);
            } else if (body[i].type === 'WhileStatement') {
                handleWhileStatement(body[i]);
            } else if (body[i].type === 'ForStatement') {
                handleForStatement(body[i]);
            } else if (body[i].type === 'VariableDeclaration') {
                handleVariableDeclaration(body[i]);
            } else if (body[i].type === 'ReturnStatement') {
                handleReturnStatement(body[i]);
            } else if (body[i].type === 'TryStatement') {
                handleTryStatement(body[i]);
            } else if (body[i].type === 'SwitchStatement') {
                handleSwitchStatement(body[i]);
            } else {
                //bm_eventDispatcher.log(body[i].type);
                //bm_eventDispatcher.log(body[i]);
            }
        }
    }

    function getBinaryElement(element) {
        switch (element.type) {
            case "Literal":
            case "Identifier":
                return element;
            case "CallExpression":
                handleCallExpression(element);
                return element;
            case "BinaryExpression":
                return convertBinaryExpression(element);
            case "UnaryExpression":
                return convertUnaryExpression(element);
            case "MemberExpression":
                handleMemberExpression(element);
                return element;
            case "UpdateExpression":
                return element;
            default:
                //bm_eventDispatcher.log('es: ', element);
                return element;
        }
    }

    function getOperatorName(operator) {
        switch (operator) {
            case '+':
                return 'sum';
            case '-':
                return 'sub';
            case '*':
                return 'mul';
            case '/':
                return 'div';

        }
    }

    function isOperatorTransformable(operator){
        switch(operator){
            case '+':
            case '-':
            case '*':
            case '/':
                return true;
        }
        return false;
    }

    function convertBinaryExpression(expression) {
        if (expression.left.type === 'Literal' && expression.right.type === 'Literal') {
            return expression;
        }
        if(!isOperatorTransformable(expression.operator)){
            return expression;
        }
        var callStatementOb = {
            'arguments': [
                getBinaryElement(expression.left),
                getBinaryElement(expression.right)
            ],
            type: "CallExpression",
            callee: {
                name: getOperatorName(expression.operator),
                type: 'Identifier'
            }
        };
        return callStatementOb;
    }

    function convertUnaryExpression(expression){
        if(expression.operator === '-' && expression.argument.type !== 'Literal'){
            var callStatementOb = {
                'arguments': [
                    getBinaryElement(expression.argument)
                ],
                type: "CallExpression",
                callee: {
                    name: '$bm_neg',
                    type: 'Identifier'
                }
            };
            return callStatementOb;
        }
        return expression;
    }

    function handleMemberExpression(expression) {
        if (expression.property.type === 'BinaryExpression') {
            expression.property = convertBinaryExpression(expression.property);
        } else if (expression.property.type === 'UnaryExpression') {
            expression.property = convertUnaryExpression(expression.property);
        } else if (expression.property.type === 'CallExpression') {
            handleCallExpression(expression.property);
        }
        if (expression.object){
            if (expression.object.type === 'BinaryExpression') {
                expression.object = convertBinaryExpression(expression.property);
            } else if (expression.object.type === 'UnaryExpression') {
                expression.object = convertUnaryExpression(expression.property);
            } else if (expression.object.type === 'CallExpression') {
                handleCallExpression(expression.object);
            }
        }
    }

    function handleCallExpression(expression) {
        var args = expression['arguments'];
        var i, len = args.length;
        for (i = 0; i < len; i += 1) {
            if (args[i].type === 'BinaryExpression') {
                args[i] = convertBinaryExpression(args[i]);
            } else if (args[i].type === 'UnaryExpression') {
                args[i] = convertUnaryExpression(args[i]);
            } else  if (args[i].type === 'CallExpression') {
                handleCallExpression(args[i]);
            } else  if (args[i].type === 'MemberExpression') {
                handleMemberExpression(args[i]);
            }
        }
        if(expression.callee.name === 'eval'){
            var wrappingNode = {
                type: 'MemberExpression',
                computed: true,
                object: {
                    type: 'ArrayExpression',
                    elements: [
                        args[0]
                    ]

                },
                property: {
                    value: 0,
                    type: 'Literal',
                    raw: '0'
                }
            }
            args[0] = wrappingNode
        }
    }

    function handleIfStatement(ifStatement) {
        if (ifStatement.consequent) {
            if (ifStatement.consequent.type === 'BlockStatement') {
                searchOperations(ifStatement.consequent.body);
            } else if (ifStatement.consequent.type === 'ExpressionStatement') {
                handleExpressionStatement(ifStatement.consequent);
            } else if (ifStatement.consequent.type === 'ReturnStatement') {
                handleReturnStatement(ifStatement.consequent);
            }
        }
        if (ifStatement.alternate) {
            if (ifStatement.alternate.type === 'IfStatement') {
                handleIfStatement(ifStatement.alternate);
            } else if (ifStatement.alternate.type === 'BlockStatement') {
                searchOperations(ifStatement.alternate.body);
            } else if (ifStatement.alternate.type === 'ExpressionStatement') {
                handleExpressionStatement(ifStatement.alternate);
            }
        }
    }

    function handleTryStatement(tryStatement) {
        if (tryStatement.block) {
            if (tryStatement.block.type === 'BlockStatement') {
                searchOperations(tryStatement.block.body);
            }
        }
        if (tryStatement.handler) {
            if (tryStatement.handler.body.type === 'BlockStatement') {
                searchOperations(tryStatement.handler.body.body);
            }
        }
    }

    function handleSwitchStatement(switchStatement) {
        var cases = switchStatement.cases;
        var i, len = cases.length;
        for(i = 0; i < len; i += 1) {
            searchOperations(cases[i].consequent);
        }
    }

    function handleWhileStatement(whileStatement) {
        if (whileStatement.body) {
            if (whileStatement.body.type === 'BlockStatement') {
                searchOperations(whileStatement.body.body);
            } else if (whileStatement.body.type === 'ExpressionStatement') {
                handleExpressionStatement(whileStatement.body);
            }
        }
        if (whileStatement.test) {
            if (whileStatement.test.type === 'MemberExpression') {
                handleMemberExpression(whileStatement.test);
            }
        }
    }

    function handleForStatement(forStatement) {
        if (forStatement.body) {
            if (forStatement.body.type === 'BlockStatement') {
                searchOperations(forStatement.body.body);
            } else if (forStatement.body.type === 'ExpressionStatement') {
                handleExpressionStatement(forStatement.body);
            }
        }
    }

    function handleReturnStatement(returnStatement) {
        if (returnStatement.argument) {
            returnStatement.argument = getBinaryElement(returnStatement.argument);
        }
    }

    function handleVariableDeclaration(variableDeclaration) {
        var declarations = variableDeclaration.declarations;
        var i, len = declarations.length;
        for (i = 0; i < len; i += 1) {
            if (declarations[i].init) {
                if (declarations[i].init.type === 'BinaryExpression') {
                    declarations[i].init = convertBinaryExpression(declarations[i].init);
                } else if (declarations[i].init.type === 'UnaryExpression') {
                    declarations[i].init = convertUnaryExpression(declarations[i].init);
                } else if (declarations[i].init.type === 'CallExpression') {
                    handleCallExpression(declarations[i].init);
                } else if (declarations[i].init.type === 'ConditionalExpression') {
                    handleConditionalExpression(declarations[i].init);
                }
            }
        }
    }

    function handleAssignmentExpression(assignmentExpression) {
        if(assignmentExpression.right){
            if(assignmentExpression.right.type === 'BinaryExpression') {
                assignmentExpression.right = convertBinaryExpression(assignmentExpression.right);
            } else if (assignmentExpression.right.type === 'UnaryExpression') {
                assignmentExpression.right = convertUnaryExpression(assignmentExpression.right);
            } else if (assignmentExpression.right.type === 'CallExpression') {
                handleCallExpression(assignmentExpression.right);
            } else  if (assignmentExpression.right.type=== 'MemberExpression') {
                handleMemberExpression(assignmentExpression.right);
            }
        }
    }

    function handleConditionalExpression(conditionalExpression) {
        if(conditionalExpression.consequent){
            if (conditionalExpression.consequent.type=== 'AssignmentExpression') {
                handleAssignmentExpression(conditionalExpression.consequent);
            } else if (conditionalExpression.consequent.type=== 'BinaryExpression') {
                conditionalExpression.consequent = convertBinaryExpression(conditionalExpression.consequent);
            }
        }
        if(conditionalExpression.alternate){
            if (conditionalExpression.alternate.type=== 'AssignmentExpression') {
                handleAssignmentExpression(conditionalExpression.alternate);
            } else if (conditionalExpression.alternate.type=== 'BinaryExpression') {
                conditionalExpression.alternate = convertBinaryExpression(conditionalExpression.alternate);
            }
        }
    }

    function handleExpressionStatement(expressionStatement) {
        if (expressionStatement.expression.type === 'CallExpression') {
            handleCallExpression(expressionStatement.expression);
        } else if (expressionStatement.expression.type === 'BinaryExpression') {
            expressionStatement.expression = convertBinaryExpression(expressionStatement.expression);
        } else if (expressionStatement.expression.type === 'UnaryExpression') {
            expressionStatement.expression = convertUnaryExpression(expressionStatement.expression);
        } else if (expressionStatement.expression.type === 'AssignmentExpression') {
            handleAssignmentExpression(expressionStatement.expression);
        } else if (expressionStatement.expression.type === 'ConditionalExpression') {
            handleConditionalExpression(expressionStatement.expression);
        }
    }

    function handleFunctionDeclaration(functionDeclaration) {
        if (functionDeclaration.body && functionDeclaration.body.type === 'BlockStatement') {
            searchOperations(functionDeclaration.body.body);
        }
    }

    function replaceOperations(body) {
        searchOperations(body);
    }

    function createAssignmentObject(){
        return {
            type: 'ExpressionStatement',
            expression: createAssignmentExpressionObject()
        }
    }

    function createAssignmentExpressionObject(){
        return {
                left: {
                    name: '$bm_rt',
                        type: 'Identifier'
                },
                type: "AssignmentExpression",
                    operator: '='
            }
    }

    function convertExpressionStatementToVariableDeclaration(expressionStatement) {
        var assignmentObject;
        if(expressionStatement.expression.type === 'Literal'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'Identifier'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'CallExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'ArrayExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'BinaryExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'MemberExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'LogicalExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'UnaryExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'ConditionalExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'AssignmentExpression'){
            assignmentObject = createAssignmentObject();
            assignmentObject.expression.right = expressionStatement.expression;
            return assignmentObject;
        } else if(expressionStatement.expression.type === 'SequenceExpression'){
            assignmentObject = createAssignmentExpressionObject();
            assignmentObject.right = expressionStatement.expression.expressions[expressionStatement.expression.expressions.length - 1];
            expressionStatement.expression.expressions[expressionStatement.expression.expressions.length - 1] = assignmentObject;
        }
        return expressionStatement;
    }

    function assignVariableToIfStatement(ifStatement){
        if (ifStatement.consequent) {
            if (ifStatement.consequent.type === 'BlockStatement') {
                assignVariable(ifStatement.consequent.body);
            } else if (ifStatement.consequent.type === 'ExpressionStatement') {
                ifStatement.consequent = convertExpressionStatementToVariableDeclaration(ifStatement.consequent);
            }
        }
        if (ifStatement.alternate) {
            if (ifStatement.alternate.type === 'IfStatement') {
                assignVariableToIfStatement(ifStatement.alternate);
            } else if (ifStatement.alternate.type === 'BlockStatement') {
                assignVariable(ifStatement.alternate.body);
            } else if (ifStatement.alternate.type === 'ExpressionStatement') {
                ifStatement.alternate = convertExpressionStatementToVariableDeclaration(ifStatement.alternate);
            }
        }
    }

    function assignVariableToSwitchStatement(switchStatement) {
        var cases = switchStatement.cases;
        var i, len = cases.length;
        for (i = 0; i < len; i += 1) {
            if (cases[i].consequent.length) {
                assignVariable(cases[i].consequent)
            }
        }
    }

    function assignVariable(body){
        var len = body.length - 1;
        var flag = len >= 0 ? true : false;
        var lastElem;
        while (flag) {
            lastElem = body[len];
            if(lastElem.type === 'IfStatement'){
                assignVariableToIfStatement(lastElem);
                body[len] = lastElem;
                len -= 1;
            } else if (lastElem.type === 'SwitchStatement') {
                assignVariableToSwitchStatement(lastElem); 
                body[len] = lastElem;
                flag = false;
            } else if (lastElem.type === 'ExpressionStatement') {
                lastElem = convertExpressionStatementToVariableDeclaration(lastElem);
                body[len] = lastElem;
                flag = false;
            } else if (lastElem.type === 'TryStatement') {
                if (lastElem.block) {
                    if (lastElem.block.type === 'BlockStatement') {
                        assignVariable(lastElem.block.body);
                    }
                }
                if (lastElem.handler) {
                    if (lastElem.handler.body.type === 'BlockStatement') {
                        assignVariable(lastElem.handler.body.body);
                    }
                }
                body[len] = lastElem;
                flag = false;
            } else if ((lastElem.type !== 'EmptyStatement' && lastElem.type !== 'FunctionDeclaration' && lastElem.type !== 'BreakStatement') || len === 0) {
                flag = false;
            } else {
                len -= 1;
            }
            if(len < 0){
                flag = false;
            }
        }
    }

    function checkExpression(prop, returnOb) {
        if (prop.expressionEnabled && !prop.expressionError) {
            pendingBodies.length = 0;
            doneBodies.length = 0;
            expressionStr = prop.expression;
            expressionStr = correctEaseAndWizz(expressionStr);
            expressionStr = correctKhanyu(expressionStr);
            expressionStr = correctElseToken(expressionStr);
            expressionStr = renameNameProperty(expressionStr);
            searchUndeclaredVariables();
            var parsed = esprima.parse(expressionStr, options);
            var body = parsed.body;
            if(expressionStr.indexOf("use javascript") !== 1){
                replaceOperations(body);
            }
            assignVariable(body);

            var escodegen = ob.escodegen;
            expressionStr = escodegen.generate(parsed);

            expressionStr = 'var $bm_rt;\n' + expressionStr;
            returnOb.x = expressionStr;
        }
    }

    function renameNameProperty(str){
        var regName = /([.'"])name([\s'";.\)\]])/g;
        return str.replace(regName,'$1_name$2');
    }

    function correctElseToken(str){
        var regElse = / else /g;
        return str.replace(regElse,'\n else ');
    }

    function correctKhanyu(str){
        var easeRegex = /Khanyu\s[0-9. ]+/;
        if (easeRegex.test(str)) {
            str = str.replace('key(1)[1];', 'key(1)[1].length;');
            str = str.replace('key(1)[2];', 'key(1)[2].length;');
        }
        return str;
    }

    function correctEaseAndWizz(str){
        var easeRegex = /Ease and Wizz\s[0-9. ]+:/;
        if (easeRegex.test(str)) {
            str = str.replace('key(1)[1];', 'key(1)[1].length;');
            str = str.replace('key(1)[2];', 'key(1)[2].length;');
        }
        return str;
    }

    ob.checkExpression = checkExpression;

    return ob;
}());